import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { lead, pipelineStage } from "@/lib/db/schema/pipeline";
import { eq, and, asc } from "drizzle-orm";
import { evolutionFetchProfilePicture } from "@/lib/evolution";
import { getNextFollowUp } from "@/lib/automations/chain-preview";
import type { UserRole } from "@/types";

const updateConversationSchema = z.object({
  classification: z.enum(["hot", "warm", "cold", "active_client", "new"]).optional(),
  contactName: z.string().optional().nullable(),
  contactAlias: z.string().optional().nullable(),
  unreadCount: z.number().int().min(0).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canView = await checkPermission(ctx.userId, ctx.role as UserRole, "crm", "view", ctx);
    if (!canView) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    // Validar que a conversation pertence ao tenant do user
    let [conversation] = await db
      .select()
      .from(crmConversation)
      .where(and(eq(crmConversation.id, id), eq(crmConversation.tenantId, ctx.tenantId)))
      .limit(1);

    if (!conversation) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

    // Fetch profile pic lazily — only for non-groups, only when null
    const isGroup = conversation.contactJid?.endsWith("@g.us") ?? false;
    if (!isGroup && conversation.contactProfilePicUrl === null) {
      try {
        const [wNum] = await db
          .select({ uazapiSession: whatsappNumber.uazapiSession })
          .from(whatsappNumber)
          .where(eq(whatsappNumber.id, conversation.whatsappNumberId))
          .limit(1);
        if (wNum?.uazapiSession && wNum.uazapiSession !== "baileys") {
          const pic = await evolutionFetchProfilePicture(wNum.uazapiSession, conversation.contactPhone);
          const picToSave = pic ?? "none";
          await db.update(crmConversation).set({ contactProfilePicUrl: picToSave }).where(eq(crmConversation.id, id));
          conversation = { ...conversation, contactProfilePicUrl: pic ?? "none" };
        }
      } catch { /* ignore */ }
    }

    const messages = await db
      .select()
      .from(crmMessage)
      .where(eq(crmMessage.conversationId, id))
      .orderBy(asc(crmMessage.timestamp));

    // Mark as read
    if (conversation.unreadCount > 0) {
      await db
        .update(crmConversation)
        .set({ unreadCount: 0 })
        .where(eq(crmConversation.id, id));
    }

    // Buscar lead vinculado (se existir)
    const [linkedLead] = await db
      .select({
        id: lead.id,
        name: lead.name,
        companyName: lead.companyName,
        stageName: pipelineStage.name,
        stageColor: pipelineStage.color,
        estimatedValue: lead.estimatedValue,
        isConverted: lead.isConverted,
      })
      .from(lead)
      .leftJoin(pipelineStage, eq(lead.stageId, pipelineStage.id))
      .where(
        and(
          eq(lead.crmConversationId, id),
          eq(lead.tenantId, ctx.tenantId)
        )
      )
      .limit(1);

    const nextFollowUp = linkedLead
      ? await getNextFollowUp({ tenantId: ctx.tenantId, leadId: linkedLead.id })
      : null;

    return NextResponse.json({
      conversation: { ...conversation, unreadCount: 0 },
      messages,
      linkedLead: linkedLead ? { ...linkedLead, nextFollowUp } : null,
    });
  } catch {
    console.error("[CRM] GET conversation failed:", { operation: "get" });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "crm", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const body = await request.json();
    const parsed = updateConversationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const d = parsed.data;
    if (d.classification !== undefined) updates.classification = d.classification;
    if (d.contactName !== undefined) updates.contactName = d.contactName;
    if (d.contactAlias !== undefined) updates.contactAlias = d.contactAlias;
    if (d.unreadCount !== undefined) updates.unreadCount = d.unreadCount;

    const [updated] = await db
      .update(crmConversation)
      .set(updates)
      .where(and(eq(crmConversation.id, id), eq(crmConversation.tenantId, ctx.tenantId)))
      .returning();

    if (!updated) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    return NextResponse.json({ conversation: updated });
  } catch {
    console.error("[CRM] PATCH conversation failed:", { operation: "update" });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
