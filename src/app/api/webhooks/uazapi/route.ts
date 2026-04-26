/**
 * Webhook legado (sem instanceId na URL).
 * Busca whatsappNumber por uazapiSession do payload.
 * Novo webhook recomendado: /api/webhooks/uazapi/[instanceId]
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { eq, and } from "drizzle-orm";
import { extractPhone, extractContent } from "@/lib/uazapi";

interface UazapiWebhookPayload {
  event?: string;
  session?: string;
  data?: {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean };
    message?: Record<string, unknown>;
    messageTimestamp?: number;
    pushName?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    // Validate webhook token — Uazapi sends the instance token in the Authorization header (raw, no Bearer prefix).
    // Accept UAZAPI_TOKEN (primary) or UAZAPI_WEBHOOK_SECRET (legacy fallback).
    const receivedToken =
      request.headers.get("authorization") ??
      request.headers.get("x-webhook-secret") ??
      "";
    const validTokens = [
      process.env.UAZAPI_TOKEN,
      process.env.UAZAPI_WEBHOOK_SECRET,
    ].filter(Boolean);

    if (validTokens.length > 0 && !validTokens.includes(receivedToken)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload: UazapiWebhookPayload = await request.json();

    // Only process incoming messages
    if (payload.event !== "messages.upsert" && payload.event !== "message") {
      return NextResponse.json({ ok: true });
    }

    const key = payload.data?.key;
    if (!key || key.fromMe) return NextResponse.json({ ok: true }); // ignore outgoing

    const session = payload.session;
    const remoteJid = key.remoteJid ?? "";
    if (!session || !remoteJid || remoteJid.includes("@g.us")) {
      return NextResponse.json({ ok: true }); // ignore group messages
    }

    const contactPhone = extractPhone(remoteJid);
    const { content, mediaType } = extractContent(payload as unknown as Record<string, unknown>);
    const pushName = payload.data?.pushName ?? null;

    // Find the WhatsApp number by session
    const [wNum] = await db
      .select()
      .from(whatsappNumber)
      .where(eq(whatsappNumber.uazapiSession, session))
      .limit(1);

    if (!wNum) {
      console.error("[WEBHOOK] Uazapi session not found:", { session: session.slice(-4) });
      return NextResponse.json({ ok: true });
    }

    // Upsert conversation
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

    if (existing[0]) {
      conversationId = existing[0].id;
      await db
        .update(crmConversation)
        .set({
          lastMessageAt: new Date(),
          unreadCount: existing[0].unreadCount + 1,
          contactPushName: pushName ?? existing[0].contactPushName,
          updatedAt: new Date(),
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
          lastMessageAt: new Date(),
          unreadCount: 1,
        })
        .returning();
      conversationId = newConv.id;
    }

    // Store message
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
    // Always return 200 to Uazapi to avoid retry storms
    return NextResponse.json({ ok: true });
  }
}
