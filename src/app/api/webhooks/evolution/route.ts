import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { whatsappNumber, crmConversation, crmMessage } from "@/lib/db/schema/crm";
import { lead, pipelineStage } from "@/lib/db/schema/pipeline";
import { eq, and, asc } from "drizzle-orm";
import { evolutionGetMediaBase64, evolutionFetchProfilePicture, evolutionFetchGroupMetadata } from "@/lib/evolution";
import { triggerFirstMessage, processPendingAutomations } from "@/lib/automations/runner";
import { uploadWhatsappMedia } from "@/lib/supabase-storage";

/**
 * POST /api/webhooks/evolution
 * Recebe eventos da Evolution API (mensagens, conexão).
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    const event: string = payload.event ?? payload.type ?? "";
    const instanceName: string = payload.instance ?? "";

    if (!instanceName) return NextResponse.json({ ok: true });

    // ── CONNECTION_UPDATE ────────────────────────────────────────────
    if (event === "CONNECTION_UPDATE" || event === "connection.update") {
      const state = payload.data?.state ?? payload.data?.connection;

      if (state === "open") {
        const phone = payload.data?.me?.id?.replace(/:.*$/, "").replace(/@.*$/, "") ?? null;

        if (phone) {
          await db
            .update(whatsappNumber)
            .set({ phoneNumber: phone, isActive: true })
            .where(eq(whatsappNumber.uazapiSession, instanceName));
        }
      }

      if (state === "close" || state === "closed") {
        await db
          .update(whatsappNumber)
          .set({ isActive: false })
          .where(eq(whatsappNumber.uazapiSession, instanceName));
      }

      return NextResponse.json({ ok: true });
    }

    // ── MESSAGES_UPSERT ──────────────────────────────────────────────
    if (event === "MESSAGES_UPSERT" || event === "messages.upsert") {
      const messages = Array.isArray(payload.data)
        ? payload.data
        : [payload.data].filter(Boolean);

      const [wNum] = await db
        .select()
        .from(whatsappNumber)
        .where(eq(whatsappNumber.uazapiSession, instanceName))
        .limit(1);

      if (!wNum) return NextResponse.json({ ok: true });

      for (const msg of messages) {
        const fromMe: boolean = msg.key?.fromMe ?? false;

        const rawRemoteJid: string = msg.key?.remoteJid ?? "";
        if (!rawRemoteJid) continue;

        const isGroup = rawRemoteJid.endsWith("@g.us");
        // Bloqueio total de grupos — automações NUNCA devem disparar em grupos
        if (isGroup) continue;

        // Quando remoteJid é LID (@lid), Baileys manda o JID real em remoteJidAlt.
        // Usamos o JID real pra conseguir responder (LID não aceita sendText direto).
        const remoteJidAlt: string | undefined = msg.key?.remoteJidAlt;
        const isLid = rawRemoteJid.endsWith("@lid");
        const effectiveJid = isLid && remoteJidAlt ? remoteJidAlt : rawRemoteJid;

        const contactPhone = effectiveJid.replace(/@.*$/, "").replace(/\D/g, "");
        const contactJid = effectiveJid;
        const senderName: string | null = null; // só se aplica em grupos (já bloqueados)
        const pushName: string | null = msg.pushName ?? null;
        const content = extractContent(msg);
        const mediaType = extractMediaType(msg);

        // Mídia: 1) base64 do payload   2) /chat/getBase64FromMediaMessage
        // (removido fallback de CDN URL direto — WhatsApp criptografa, só Evolution decripta)
        let mediaUrl = extractMediaUrl(msg);
        if (!mediaUrl && mediaType !== "text") {
          if (process.env.NODE_ENV === "development") {
            console.log(`[EVOLUTION DEBUG] buscando mídia via API pra msg ${msg.key?.id} mediaType=${mediaType}`);
          }
          const fetched = await evolutionGetMediaBase64(wNum.uazapiSession, msg as Record<string, unknown>);
          if (fetched.base64) {
            const b64 = fetched.base64.startsWith("data:") ? fetched.base64 : `data:${fetched.mimetype ?? "application/octet-stream"};base64,${fetched.base64}`;
            mediaUrl = b64;
            if (process.env.NODE_ENV === "development") {
              console.log(`[EVOLUTION DEBUG] ✓ mídia obtida: ${b64.length} chars, mime=${fetched.mimetype}`);
            }
          } else {
            console.warn(`[EVOLUTION] getBase64 retornou vazio pra msg ${msg.key?.id}. error=${fetched.error ?? "(nenhum)"}`);
          }
        }

        let conv: { id: string } | undefined;

        if (fromMe) {
          // Mensagem enviada do celular: só adicionar a conversa JÁ existente
          const [existing] = await db
            .select({ id: crmConversation.id })
            .from(crmConversation)
            .where(and(
              eq(crmConversation.whatsappNumberId, wNum.id),
              eq(crmConversation.contactPhone, contactPhone),
            ))
            .limit(1);
          if (!existing) continue; // conversa ainda não existe, ignorar
          conv = existing;
          await db
            .update(crmConversation)
            .set({ lastMessageAt: new Date(), lastOutgoingAt: new Date(), updatedAt: new Date() })
            .where(eq(crmConversation.id, existing.id));
        } else {
          // Mensagem recebida: upsert conversa normalmente
          const now = new Date();
          const [upserted] = await db
            .insert(crmConversation)
            .values({
              tenantId: wNum.tenantId,
              whatsappNumberId: wNum.id,
              contactPhone,
              contactJid,
              contactName: pushName,
              contactPushName: pushName,
              isGroup: false,
              lastMessageAt: now,
              lastIncomingAt: now,
              unreadCount: 1,
            })
            .onConflictDoUpdate({
              target: [crmConversation.whatsappNumberId, crmConversation.contactPhone],
              set: {
                contactJid,
                lastMessageAt: now,
                lastIncomingAt: now,
                unreadCount: 1,
                contactPushName: pushName ?? undefined,
                updatedAt: now,
              },
            })
            .returning();
          conv = upserted;

          // Fetch group name if we don't have it yet
          if (isGroup && !upserted.contactName) {
            try {
              const meta = await evolutionFetchGroupMetadata(wNum.uazapiSession, contactJid);
              if (meta?.subject) {
                await db.update(crmConversation)
                  .set({ contactName: meta.subject })
                  .where(eq(crmConversation.id, upserted.id));
              }
            } catch { /* ignore */ }
          }

          // Best-effort: fetch profile pic once per contact (only for non-groups, only when null)
          if (!isGroup && upserted.contactProfilePicUrl === null) {
            try {
              const pic = await evolutionFetchProfilePicture(wNum.uazapiSession, contactPhone);
              await db.update(crmConversation)
                .set({ contactProfilePicUrl: pic ?? "none" })
                .where(eq(crmConversation.id, upserted.id));
            } catch { /* ignore */ }
          }
        }

        // Dedup por messageIdWa — check rápido (INSERT também tem UNIQUE + ON CONFLICT abaixo)
        if (msg.key?.id) {
          const exists = await db
            .select({ id: crmMessage.id })
            .from(crmMessage)
            .where(eq(crmMessage.messageIdWa, msg.key.id))
            .limit(1);
          if (exists.length > 0) continue; // já processamos essa msg
        }

        // Se mediaUrl é data URI, sobe pro Storage e troca pela URL pública
        let finalMediaUrl = mediaUrl;
        if (mediaUrl?.startsWith("data:")) {
          const uploaded = await uploadWhatsappMedia({
            tenantId: wNum.tenantId,
            conversationId: conv.id,
            data: mediaUrl,
          });
          if (uploaded) finalMediaUrl = uploaded.publicUrl;
        }

        const quote = extractQuote(msg);
        const insertedMsg = await db
          .insert(crmMessage)
          .values({
            conversationId: conv.id,
            messageIdWa: msg.key?.id ?? null,
            direction: fromMe ? "outgoing" : "incoming",
            content,
            mediaType,
            mediaUrl: finalMediaUrl,
            status: fromMe ? "sent" : "delivered",
            quotedMessageId: quote?.quotedMessageId ?? null,
            quotedContent: quote?.quotedContent ?? null,
            senderName: senderName ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: crmMessage.id });

        // Se conflict (msg duplicada do Evolution), pula o autoCreateLead pra não
        // disparar welcome duas vezes.
        if (insertedMsg.length === 0) continue;

        if (!fromMe && !isGroup) await autoCreateLead(wNum.tenantId, contactPhone, pushName, conv.id);
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[WEBHOOK:EVOLUTION]", e);
    return NextResponse.json({ ok: true }); // sempre 200 para o Evolution não reenviar
  }
}

function extractQuote(msg: Record<string, unknown>): { quotedMessageId: string; quotedContent: string } | null {
  const m = msg.message as Record<string, unknown> | undefined;
  const ext = m?.extendedTextMessage as Record<string, unknown> | undefined;
  const ctx = ext?.contextInfo as Record<string, unknown> | undefined;
  if (!ctx?.stanzaId) return null;
  const qm = ctx.quotedMessage as Record<string, unknown> | undefined;
  let quotedContent = "";
  if (typeof qm?.conversation === "string") quotedContent = qm.conversation;
  else {
    const qext = qm?.extendedTextMessage as Record<string, unknown> | undefined;
    if (typeof qext?.text === "string") quotedContent = qext.text;
    else if (qm?.imageMessage) quotedContent = "📷 Imagem";
    else if (qm?.audioMessage) quotedContent = "🎤 Áudio";
    else if (qm?.videoMessage) quotedContent = "🎥 Vídeo";
    else if (qm?.documentMessage) quotedContent = "📄 Documento";
    else quotedContent = "Mensagem";
  }
  return { quotedMessageId: ctx.stanzaId as string, quotedContent };
}

function extractContent(msg: Record<string, unknown>): string | null {
  const m = msg.message as Record<string, unknown> | undefined;
  if (!m) return null;
  if (typeof m.conversation === "string") return m.conversation;
  const ext = m.extendedTextMessage as Record<string, unknown> | undefined;
  if (typeof ext?.text === "string") return ext.text;
  const img = m.imageMessage as Record<string, unknown> | undefined;
  if (typeof img?.caption === "string") return img.caption;
  return null;
}

function extractMediaUrl(msg: Record<string, unknown>): string | null {
  // Evolution v2 with webhookBase64:true — try top-level then nested
  const b64 = (msg.base64 ?? (msg.message as Record<string, unknown> | undefined)?.base64) as string | undefined;
  if (!b64) return null;
  // Evolution may send a complete data URI already
  if (b64.startsWith("data:")) return b64;
  const mt = extractMediaType(msg);
  if (mt === "audio") return `data:audio/ogg;base64,${b64}`;
  if (mt === "image") return `data:image/jpeg;base64,${b64}`;
  if (mt === "video") return `data:video/mp4;base64,${b64}`;
  return null;
}

function extractMediaType(msg: Record<string, unknown>): string {
  const m = msg.message as Record<string, unknown> | undefined;
  if (!m) return "text";
  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.audioMessage) return "audio";
  if (m.documentMessage) return "document";
  return "text";
}

async function autoCreateLead(tenantId: string, phone: string, name: string | null, crmConversationId?: string) {
  try {
    const [firstStage] = await db
      .select({ id: pipelineStage.id })
      .from(pipelineStage)
      .where(eq(pipelineStage.tenantId, tenantId))
      .orderBy(asc(pipelineStage.order))
      .limit(1);

    if (!firstStage) return;

    // INSERT race-safe: UNIQUE(tenant_id, phone) no DB garante só 1 lead.
    // Se já existe, returning fica vazio → NÃO disparamos welcome.
    const inserted = await db
      .insert(lead)
      .values({
        tenantId,
        name: name || phone,
        phone,
        stageId: firstStage.id,
        source: "whatsapp",
        pushName: name,
        crmConversationId: crmConversationId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: lead.id });

    // returning vazio = conflict (lead já existia) → não dispara welcome
    if (inserted.length === 0) return;

    const newLead = inserted[0];

    try {
      await triggerFirstMessage({ tenantId, leadId: newLead.id });
      await processPendingAutomations(10);
    } catch {
      // best-effort
    }
  } catch {
    // best-effort
  }
}
