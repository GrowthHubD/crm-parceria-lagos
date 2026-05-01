import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { lead, pipelineStage } from "@/lib/db/schema/pipeline";
import { eq, and, asc } from "drizzle-orm";
import { extractPhone, extractContent } from "@/lib/uazapi";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    const { instanceId } = await params;

    // Buscar whatsappNumber pelo ID da instância
    const [wNum] = await db
      .select()
      .from(whatsappNumber)
      .where(eq(whatsappNumber.id, instanceId))
      .limit(1);

    if (!wNum) {
      return NextResponse.json({ ok: true }); // instância não encontrada
    }

    // Validar token contra o token da instância. Defesa em profundidade:
    // o token da instância é único por whatsappNumber, então se o request
    // chegou na rota /[instanceId] com um token, o token TEM que bater com
    // o uazapiToken daquela instância — se cair pro fallback global, valida
    // pelo menos o caller saber um token global válido.
    const receivedToken =
      request.headers.get("authorization") ??
      request.headers.get("x-webhook-secret") ??
      "";

    const instanceMatch =
      Boolean(wNum.uazapiToken) &&
      wNum.uazapiToken !== "baileys" &&
      receivedToken === wNum.uazapiToken;

    if (!instanceMatch) {
      // Fallback: aceitar tokens globais (ex.: ambiente de dev compartilhado)
      const globalTokens = [
        process.env.UAZAPI_TOKEN,
        process.env.UAZAPI_WEBHOOK_SECRET,
      ].filter(Boolean) as string[];

      const globalMatch =
        globalTokens.length > 0 && globalTokens.includes(receivedToken);

      if (!globalMatch) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const payload = await request.json();

    // Só processar mensagens recebidas
    if (payload.event !== "messages.upsert" && payload.event !== "message") {
      return NextResponse.json({ ok: true });
    }

    const key = payload.data?.key;
    if (!key || key.fromMe) return NextResponse.json({ ok: true });

    const remoteJid = key.remoteJid ?? "";
    if (!remoteJid || remoteJid.includes("@g.us")) {
      return NextResponse.json({ ok: true });
    }

    const contactPhone = extractPhone(remoteJid);
    const { content, mediaType } = extractContent(payload);
    const pushName = payload.data?.pushName ?? null;

    // Upsert conversation (usando tenantId da instância)
    const existing = await db
      .select()
      .from(crmConversation)
      .where(
        and(
          eq(crmConversation.whatsappNumberId, wNum.id),
          eq(crmConversation.contactPhone, contactPhone)
        )
      )
      .limit(1);

    let conversationId: string;

    const nowTs = new Date();

    if (existing[0]) {
      conversationId = existing[0].id;
      await db
        .update(crmConversation)
        .set({
          lastMessageAt: nowTs,
          lastIncomingAt: nowTs,
          unreadCount: existing[0].unreadCount + 1,
          contactPushName: pushName ?? existing[0].contactPushName,
          updatedAt: nowTs,
        })
        .where(eq(crmConversation.id, conversationId));
    } else {
      const [newConv] = await db
        .insert(crmConversation)
        .values({
          whatsappNumberId: wNum.id,
          tenantId: wNum.tenantId,
          contactPhone,
          contactPushName: pushName,
          classification: "new",
          isGroup: false,
          lastMessageAt: nowTs,
          lastIncomingAt: nowTs,
          unreadCount: 1,
        })
        .returning();
      conversationId = newConv.id;

      // Auto-criar lead para novo contato
      try {
        // Buscar primeiro stage do primeiro pipeline do tenant
        const [firstStage] = await db
          .select({ id: pipelineStage.id })
          .from(pipelineStage)
          .where(eq(pipelineStage.tenantId, wNum.tenantId))
          .orderBy(asc(pipelineStage.order))
          .limit(1);

        if (firstStage) {
          const [newLead] = await db
            .insert(lead)
            .values({
              tenantId: wNum.tenantId,
              name: pushName ?? contactPhone,
              phone: contactPhone,
              pushName,
              stageId: firstStage.id,
              source: "inbound",
              crmConversationId: conversationId,
            })
            .returning();

          if (newLead) {
            // Vincular conversation ao lead (bidirecional não necessário — lead.crmConversationId já aponta)
          }
        }
      } catch {
        // Auto-criação de lead é best-effort — não falhar o webhook
      }
    }

    // Armazenar mensagem
    await db.insert(crmMessage).values({
      conversationId,
      messageIdWa: key.id ?? null,
      direction: "incoming",
      content,
      mediaType,
      status: "delivered",
      timestamp: payload.data?.messageTimestamp
        ? new Date(payload.data.messageTimestamp * 1000)
        : new Date(),
    });

    return NextResponse.json({ ok: true });
  } catch {
    console.error("[WEBHOOK] Uazapi processing failed:", { operation: "upsert_message" });
    return NextResponse.json({ ok: true });
  }
}
