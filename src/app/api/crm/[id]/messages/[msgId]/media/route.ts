import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { crmConversation, crmMessage } from "@/lib/db/schema/crm";
import { eq, and } from "drizzle-orm";
import type { UserRole } from "@/types";

const MIME_MAP: Record<string, string> = {
  audio: "audio/ogg",
  image: "image/jpeg",
  video: "video/mp4",
  document: "application/octet-stream",
};

/**
 * Parseia um data URI no formato `data:<mime>[;param=value]*[;base64],<payload>`.
 * Lida com:
 *  - parâmetros tipo `audio/ogg; codecs=opus` (com espaço após `;`)
 *  - mime vazio (`data:;base64,...`)
 *  - payload sem `,` (assume base64 puro como fallback)
 *
 * Retorna `mime` (com codecs preservados) e o `payload` base64.
 */
function parseDataUri(uri: string, fallbackMime: string): { mime: string; payload: string } {
  // Header e payload separados por primeira `,`.
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) {
    return { mime: fallbackMime, payload: uri };
  }
  const header = uri.slice(0, commaIdx); // ex: "data:audio/ogg; codecs=opus;base64"
  const payload = uri.slice(commaIdx + 1);

  // Tira "data:" do início.
  const meta = header.startsWith("data:") ? header.slice(5) : header;

  // Quebra em segments: [<mime>, <param1>, ..., "base64"]
  const parts = meta.split(";").map((p) => p.trim()).filter(Boolean);
  // base64 é flag, não mime
  const mimeParts = parts.filter((p) => p.toLowerCase() !== "base64");

  if (mimeParts.length === 0) {
    return { mime: fallbackMime, payload };
  }

  // Reconstrói mime preservando params (codecs etc) — Content-Type aceita.
  // Usa `; ` como separador padrão (RFC 7231).
  const mime = mimeParts.join("; ");
  return { mime, payload };
}

function dataUriToResponse(dataUri: string, fallbackMime: string): NextResponse {
  const { mime, payload } = parseDataUri(dataUri, fallbackMime);
  const buf = Buffer.from(payload, "base64");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.byteLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  try {
    const { id, msgId } = await params;
    const ctx = await getTenantContext(request.headers);
    const canView = await checkPermission(ctx.userId, ctx.role as UserRole, "crm", "view", ctx);
    if (!canView) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const [conv] = await db
      .select({
        contactJid: crmConversation.contactJid,
        contactPhone: crmConversation.contactPhone,
        whatsappNumberId: crmConversation.whatsappNumberId,
      })
      .from(crmConversation)
      .where(and(eq(crmConversation.id, id), eq(crmConversation.tenantId, ctx.tenantId)))
      .limit(1);

    if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

    const [msg] = await db
      .select({
        messageIdWa: crmMessage.messageIdWa,
        direction: crmMessage.direction,
        mediaType: crmMessage.mediaType,
        mediaUrl: crmMessage.mediaUrl,
      })
      .from(crmMessage)
      .where(eq(crmMessage.id, msgId))
      .limit(1);

    if (!msg) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });

    const fallbackMime = MIME_MAP[msg.mediaType ?? ""] ?? "application/octet-stream";

    if (!msg.mediaUrl) {
      return NextResponse.json({ error: "Mídia não disponível" }, { status: 404 });
    }

    // URL HTTP(S) externa (Supabase Storage ou CDN) → redireciona (302)
    if (msg.mediaUrl.startsWith("http://") || msg.mediaUrl.startsWith("https://")) {
      return NextResponse.redirect(msg.mediaUrl, 302);
    }

    // Data URI legacy (mensagens antigas antes da migração pro Storage)
    return dataUriToResponse(msg.mediaUrl, fallbackMime);
  } catch (e) {
    console.error("[CRM] media fetch failed:", e);
    return NextResponse.json({ error: "Erro ao buscar mídia" }, { status: 500 });
  }
}
