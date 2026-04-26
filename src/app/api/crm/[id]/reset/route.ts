/**
 * DELETE /api/crm/[id]/reset — reseta COMPLETAMENTE uma conversa.
 *
 * Apaga: crm_message, automation_log do lead vinculado, o lead, a conversation.
 * Depois disso, próximo inbound do mesmo contato recria tudo do zero e o welcome
 * dispara de novo. Útil pra testes.
 *
 * Requer permissão de edição em CRM.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { crmConversation, crmMessage } from "@/lib/db/schema/crm";
import { lead } from "@/lib/db/schema/pipeline";
import { automationLog } from "@/lib/db/schema/automations";
import { eq, and } from "drizzle-orm";
import type { UserRole } from "@/types";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "crm", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const [conv] = await db
      .select({ id: crmConversation.id, phone: crmConversation.contactPhone, tenantId: crmConversation.tenantId })
      .from(crmConversation)
      .where(eq(crmConversation.id, id))
      .limit(1);

    if (!conv || conv.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    }

    // Deleta logs de automação do lead vinculado
    const [linkedLead] = await db
      .select({ id: lead.id })
      .from(lead)
      .where(and(eq(lead.tenantId, conv.tenantId), eq(lead.phone, conv.phone)))
      .limit(1);

    if (linkedLead) {
      await db.delete(automationLog).where(eq(automationLog.leadId, linkedLead.id));
    }

    // Deleta mensagens da conversa
    await db.delete(crmMessage).where(eq(crmMessage.conversationId, conv.id));

    // Deleta o lead (mesmo tenant+phone)
    if (linkedLead) {
      await db.delete(lead).where(eq(lead.id, linkedLead.id));
    }

    // Deleta a conversation
    await db.delete(crmConversation).where(eq(crmConversation.id, conv.id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[CRM RESET]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}
