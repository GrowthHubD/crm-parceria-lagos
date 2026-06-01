import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext, getVisibleTenantIds } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { lead, pipelineStage } from "@/lib/db/schema/pipeline";
import { eq, and, asc, inArray } from "drizzle-orm";
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

    // Filtro por tenant é obrigatório — sem ele, qualquer user logado com UUID
    // de conversa de outro tenant conseguiria enviar mensagem. Autoriza contra
    // os tenants VISÍVEIS (platform owner/superadmin respondem cross-tenant;
    // user normal = só o próprio). Resposta 404 (não 403) pra não vazar a conversa.
    const visibleTenantIds = await getVisibleTenantIds(ctx);
    const [conv] = await db
      .select({
        id: crmConversation.id,
        tenantId: crmConversation.tenantId,
        contactPhone: crmConversation.contactPhone,
        contactJid: crmConversation.contactJid,
        whatsappNumberId: crmConversation.whatsappNumberId,
      })
      .from(crmConversation)
      .where(and(eq(crmConversation.id, id), inArray(crmConversation.tenantId, visibleTenantIds)))
      .limit(1);

    if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

    const [wNum] = await db
      .select({
        uazapiSession: whatsappNumber.uazapiSession,
        uazapiToken: whatsappNumber.uazapiToken,
        serverUrl: whatsappNumber.serverUrl,
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
    // CRÍTICO: passar wNum.serverUrl pra sendText. Sem isso, ele cai no env
    // UAZAPI_BASE_URL (growthhub.uazapi.com) e tokens de tenants em outros
    // servers (ex: montanha.uazapi.com) são rejeitados com 401 Invalid token.
    const result = await sendText(
      wNum.uazapiSession,
      wNum.uazapiToken || undefined,
      target,
      parsed.data.message,
      quoted,
      wNum.serverUrl ?? undefined
    );

    // Só marca failed se sendText retornou erro EXPLÍCITO do provider.
    // Uazapi v2 pode retornar 200 sem messageId em campo conhecido (formato
    // do response mudou entre versões) — `extractMessageId` em whatsapp.ts
    // já tenta vários, mas se não achar, a mensagem foi enviada mesmo assim.
    // Não fingimos "failed" só porque o campo veio com nome diferente.
    if (result.error) {
      console.error("[CRM] sendText falhou:", {
        operation: "send",
        conversationId: id,
        provider_error: result.error,
        instance: wNum.uazapiSession,
        serverUrl: wNum.serverUrl ?? "(default)",
      });
      await db.insert(crmMessage).values({
        conversationId: id,
        messageIdWa: null,
        direction: "outgoing",
        content: parsed.data.message,
        mediaType: "text",
        status: "failed",
        quotedMessageId: quoted?.key.id ?? null,
        quotedContent,
      });
      return NextResponse.json(
        { error: result.error },
        { status: 502 }
      );
    }

    let [msg] = await db
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
      .onConflictDoNothing()
      .returning();
    // Corrida: se o webhook (fromMe) inseriu a MESMA mensagem primeiro, o
    // onConflict não retorna linha. Busca a existente pra (a) não estourar a
    // unique → 500 fantasma e (b) não pular o avanço de etapa do lead abaixo.
    if (!msg && result.messageId) {
      [msg] = await db
        .select()
        .from(crmMessage)
        .where(and(eq(crmMessage.conversationId, id), eq(crmMessage.messageIdWa, result.messageId)))
        .limit(1);
    }

    await db
      .update(crmConversation)
      .set({ lastMessageAt: new Date(), lastOutgoingAt: new Date(), updatedAt: new Date() })
      .where(eq(crmConversation.id, id));

    // Avançar lead vinculado — SÓ uma vez: se ainda está na PRIMEIRA etapa do
    // funil, move pra segunda (ex.: "Novo" → "Em contato") na primeira resposta.
    // Depois disso, enviar mensagem NÃO mexe mais na etapa. Antes, cada mensagem
    // empurrava o lead um estágio, podendo levá-lo até "Ganho" sem querer.
    try {
      const [linkedLead] = await db
        .select({ id: lead.id, stageId: lead.stageId })
        .from(lead)
        .where(and(eq(lead.crmConversationId, id), eq(lead.tenantId, conv.tenantId)))
        .limit(1);

      if (linkedLead) {
        const [currentStage] = await db
          .select({ order: pipelineStage.order, pipelineId: pipelineStage.pipelineId })
          .from(pipelineStage)
          .where(eq(pipelineStage.id, linkedLead.stageId))
          .limit(1);

        if (currentStage) {
          // Duas primeiras etapas do funil, em ordem.
          const firstTwo = await db
            .select({ id: pipelineStage.id, order: pipelineStage.order })
            .from(pipelineStage)
            .where(
              and(
                eq(pipelineStage.pipelineId, currentStage.pipelineId),
                eq(pipelineStage.tenantId, conv.tenantId)
              )
            )
            .orderBy(asc(pipelineStage.order))
            .limit(2);

          // Só avança se o lead está na primeira etapa e existe uma segunda.
          if (firstTwo.length === 2 && firstTwo[0].order === currentStage.order) {
            await db
              .update(lead)
              .set({ stageId: firstTwo[1].id, enteredStageAt: new Date(), updatedAt: new Date() })
              .where(eq(lead.id, linkedLead.id));
          }
        }
      }
    } catch { /* non-critical */ }

    return NextResponse.json({ message: msg });
  } catch (e) {
    return handleApiError(e, "CRM POST send");
  }
}
