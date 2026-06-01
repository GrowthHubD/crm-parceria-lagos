import { NextRequest, NextResponse } from "next/server";
import { getTenantContext, getVisibleTenantIds } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { crmConversation, crmMessage } from "@/lib/db/schema/crm";
import { eq, and, inArray } from "drizzle-orm";
import type { UserRole } from "@/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  try {
    const { id, msgId } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "crm", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const visibleTenantIds = await getVisibleTenantIds(ctx);
    const [conv] = await db
      .select({ id: crmConversation.id })
      .from(crmConversation)
      .where(and(eq(crmConversation.id, id), inArray(crmConversation.tenantId, visibleTenantIds)))
      .limit(1);
    if (!conv) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const body = await request.json();

    // Amarra a mensagem à conversa já autorizada (conversationId = id). Sem
    // isso, um platform owner podia passar um msgId de OUTRO tenant e alterar
    // isStarred de mensagem alheia (a conversa `id` é validada, mas msgId era
    // independente). Mesmo escopo que o DELETE abaixo já usa.
    const [updated] = await db
      .update(crmMessage)
      .set({ ...(typeof body.isStarred === "boolean" ? { isStarred: body.isStarred } : {}) })
      .where(and(eq(crmMessage.id, msgId), eq(crmMessage.conversationId, id)))
      .returning();

    if (!updated) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });
    return NextResponse.json({ message: updated });
  } catch (e) {
    return handleApiError(e, "CRM PATCH message");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  try {
    const { id, msgId } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "crm", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    // Valida que a mensagem pertence a uma conversa visível ao user
    const visibleTenantIds = await getVisibleTenantIds(ctx);
    const [conv] = await db
      .select({ id: crmConversation.id })
      .from(crmConversation)
      .where(and(eq(crmConversation.id, id), inArray(crmConversation.tenantId, visibleTenantIds)))
      .limit(1);
    if (!conv) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const [deleted] = await db
      .delete(crmMessage)
      .where(and(eq(crmMessage.id, msgId), eq(crmMessage.conversationId, id)))
      .returning({ id: crmMessage.id });

    if (!deleted) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });

    return NextResponse.json({ ok: true, id: deleted.id });
  } catch (e) {
    return handleApiError(e, "CRM DELETE message");
  }
}
