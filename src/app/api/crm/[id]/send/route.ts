import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { lead, pipelineStage } from "@/lib/db/schema/pipeline";
import { eq, and, gt } from "drizzle-orm";
import { sendText } from "@/lib/whatsapp";
import type { UserRole } from "@/types";

const sendSchema = z.object({
  message: z.string().min(1).max(4096),
  quotedMessageId: z.string().optional(), // DB id da mensagem a citar
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
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const [conv] = await db
      .select({
        id: crmConversation.id,
        contactPhone: crmConversation.contactPhone,
        contactJid: crmConversation.contactJid,
        whatsappNumberId: crmConversation.whatsappNumberId,
      })
      .from(crmConversation)
      .where(eq(crmConversation.id, id))
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

    // Resolver quoted se fornecido (só usado em Evolution — Uazapi v2 ignora)
    let quoted: { key: { id: string; remoteJid: string; fromMe: boolean }; message: { conversation: string } } | undefined;
    let quotedContent: string | null = null;
    if (parsed.data.quotedMessageId) {
      const [qMsg] = await db
        .select({ messageIdWa: crmMessage.messageIdWa, direction: crmMessage.direction, content: crmMessage.content, mediaType: crmMessage.mediaType })
        .from(crmMessage)
        .where(eq(crmMessage.id, parsed.data.quotedMessageId))
        .limit(1);
      if (qMsg?.messageIdWa) {
        const remoteJid = conv.contactJid ?? `${conv.contactPhone}@s.whatsapp.net`;
        const fromMe = qMsg.direction === "outgoing";
        quotedContent =
          qMsg.content ??
          (qMsg.mediaType === "audio"
            ? "🎤 Áudio"
            : qMsg.mediaType === "image"
              ? "📷 Imagem"
              : qMsg.mediaType === "video"
                ? "🎥 Vídeo"
                : qMsg.mediaType === "document"
                  ? "📄 Documento"
                  : "Mensagem");
        quoted = {
          key: { id: qMsg.messageIdWa, remoteJid, fromMe },
          message: { conversation: quotedContent },
        };
      }
    }

    const target = conv.contactJid ?? conv.contactPhone;
    const result = await sendText(
      wNum.uazapiSession,
      wNum.uazapiToken || undefined,
      target,
      parsed.data.message,
      quoted
    );

    const [msg] = await db
      .insert(crmMessage)
      .values({
        conversationId: id,
        messageIdWa: result.messageId ?? null,
        direction: "outgoing",
        content: parsed.data.message,
        mediaType: "text",
        status: "sent",
        quotedMessageId: quoted?.key.id ?? null,
        quotedContent,
      })
      .returning();

    await db
      .update(crmConversation)
      .set({ lastMessageAt: new Date(), lastOutgoingAt: new Date(), updatedAt: new Date() })
      .where(eq(crmConversation.id, id));

    // Avançar lead vinculado para a próxima etapa (best-effort)
    try {
      const [linkedLead] = await db
        .select({ id: lead.id, stageId: lead.stageId })
        .from(lead)
        .where(and(eq(lead.crmConversationId, id), eq(lead.tenantId, ctx.tenantId)))
        .limit(1);

      if (linkedLead) {
        const [currentStage] = await db
          .select({ order: pipelineStage.order, pipelineId: pipelineStage.pipelineId })
          .from(pipelineStage)
          .where(eq(pipelineStage.id, linkedLead.stageId))
          .limit(1);

        if (currentStage) {
          const [nextStage] = await db
            .select({ id: pipelineStage.id })
            .from(pipelineStage)
            .where(
              and(
                eq(pipelineStage.pipelineId, currentStage.pipelineId),
                eq(pipelineStage.tenantId, ctx.tenantId),
                gt(pipelineStage.order, currentStage.order)
              )
            )
            .orderBy(pipelineStage.order)
            .limit(1);

          if (nextStage) {
            await db
              .update(lead)
              .set({ stageId: nextStage.id, enteredStageAt: new Date(), updatedAt: new Date() })
              .where(eq(lead.id, linkedLead.id));
          }
        }
      }
    } catch { /* non-critical */ }

    return NextResponse.json({ message: msg });
  } catch (e) {
    console.error("[CRM] POST send failed:", e);
    return NextResponse.json({ error: "Erro ao enviar mensagem" }, { status: 500 });
  }
}
