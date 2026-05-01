import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { eq, and } from "drizzle-orm";
import { sendMedia } from "@/lib/whatsapp";
import { uploadWhatsappMedia } from "@/lib/supabase-storage";
// ffmpeg só roda em Node runtime (não em Cloudflare Workers/edge). Em CF, o
// import simplesmente não é resolvido e a conversão é pulada — áudio webm vai
// sem conversão (vira documento no WhatsApp). Pra PTT em CF: refactor futuro
// pra usar opus-recorder client-side (já instalado em deps + workers em /public/opus/).
import { ensureOggDataUri } from "@/lib/audio-convert";
import type { UserRole } from "@/types";

const schema = z.object({
  file: z.string().regex(/^data:/),
  fileName: z.string().optional(),
  isImage: z.boolean().optional(),
  /** Sinaliza áudio gravado pelo CRM (vira mensagem de voz / PTT no WhatsApp). */
  isAudio: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "crm", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const [conv] = await db
      .select({
        id: crmConversation.id,
        contactPhone: crmConversation.contactPhone,
        contactJid: crmConversation.contactJid,
        whatsappNumberId: crmConversation.whatsappNumberId,
      })
      .from(crmConversation)
      .where(and(eq(crmConversation.id, id), eq(crmConversation.tenantId, ctx.tenantId)))
      .limit(1);

    if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

    const [wNum] = await db
      .select({
        uazapiSession: whatsappNumber.uazapiSession,
        uazapiToken: whatsappNumber.uazapiToken,
      })
      .from(whatsappNumber)
      .where(eq(whatsappNumber.id, conv.whatsappNumberId))
      .limit(1);

    if (!wNum?.uazapiSession || wNum.uazapiSession === "baileys") {
      return NextResponse.json({ error: "WhatsApp não conectado" }, { status: 503 });
    }

    const { file, fileName, isImage: isImageFlag, isAudio: isAudioFlag } = parsed.data;
    const mimeMatch = file.match(/^data:([^;]+);/);
    const mimetype = mimeMatch?.[1] ?? "";
    // Prefer explicit flag from client (browser file.type is authoritative)
    const isAudio = isAudioFlag ?? mimetype.startsWith("audio/");
    const isImage = !isAudio && (isImageFlag ?? mimetype.startsWith("image/"));
    const isVideo = !isAudio && !isImage && mimetype.startsWith("video/");
    const mediaType = isAudio ? "audio" : isImage ? "image" : isVideo ? "video" : "document";

    // Pra áudio: WhatsApp PTT (balão de voz) exige `audio/ogg; codecs=opus`
    // re-encodado com bitrate 32k mono 48kHz. MediaRecorder do Chrome grava em
    // webm/opus — usamos ffmpeg (libopus -b:a 32k -ar 48000 -ac 1 -f ogg).
    // Em vez de mandar como data URI, subimos o ogg pro Storage e mandamos a
    // URL pública pra Uazapi — esse é o formato que Baileys/Uazapi reconhecem
    // confiavelmente como PTT.
    let fileForSend: string = file;
    let fileNameForSend = fileName;
    let mediaUrlStored: string | null = null;

    if (isAudio && (mimetype.includes("webm") || mimetype.includes("opus"))) {
      try {
        const oggDataUri = await ensureOggDataUri(file);
        fileNameForSend = fileName ? fileName.replace(/\.(webm|opus)$/i, ".ogg") : "audio.ogg";

        // Sobe o OGG convertido pro Storage e usa a URL pública no envio.
        // Uazapi parece preferir URL pública sobre data URI pra detectar PTT.
        const uploadedOgg = await uploadWhatsappMedia({
          tenantId: ctx.tenantId,
          conversationId: id,
          data: oggDataUri,
          mimetype: "audio/ogg",
          filename: fileNameForSend,
        });

        if (uploadedOgg?.publicUrl) {
          fileForSend = uploadedOgg.publicUrl;
          mediaUrlStored = uploadedOgg.publicUrl;
        } else {
          fileForSend = oggDataUri; // fallback: data URI
        }
      } catch (e) {
        console.warn("[send-media] audio convert falhou, enviando original:", e);
      }
    }

    // 1) Envia pro WhatsApp via facade (provider decide: Evolution dev / Uazapi prod)
    const target = conv.contactJid ?? conv.contactPhone;
    const result = await sendMedia(
      wNum.uazapiSession,
      wNum.uazapiToken || undefined,
      target,
      fileForSend,
      fileNameForSend
    );

    // 2) Sobe a mídia pro Storage (se ainda não subiu — caso de imagem/video/doc)
    if (!mediaUrlStored) {
      const uploaded = await uploadWhatsappMedia({
        tenantId: ctx.tenantId,
        conversationId: id,
        data: file,
        mimetype,
        filename: fileName,
      });
      mediaUrlStored = uploaded?.publicUrl ?? file;
    }

    const [msg] = await db
      .insert(crmMessage)
      .values({
        conversationId: id,
        messageIdWa: result.messageId ?? null,
        direction: "outgoing",
        mediaType,
        mediaUrl: mediaUrlStored,
        // Áudio e imagem não têm "content" textual; documento usa fileName.
        content: isAudio || isImage || isVideo ? null : (fileName ?? null),
        status: "sent",
      })
      .returning();

    await db
      .update(crmConversation)
      .set({ lastMessageAt: new Date(), lastOutgoingAt: new Date(), updatedAt: new Date() })
      .where(eq(crmConversation.id, id));

    return NextResponse.json({ message: msg });
  } catch (e) {
    console.error("[CRM] POST send-media failed:", e);
    return NextResponse.json({ error: "Erro ao enviar arquivo" }, { status: 500 });
  }
}
