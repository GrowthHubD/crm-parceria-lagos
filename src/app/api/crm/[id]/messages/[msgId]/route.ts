import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { crmConversation, crmMessage } from "@/lib/db/schema/crm";
import { eq, and } from "drizzle-orm";
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

    const [conv] = await db
      .select({ id: crmConversation.id })
      .from(crmConversation)
      .where(and(eq(crmConversation.id, id), eq(crmConversation.tenantId, ctx.tenantId)))
      .limit(1);
    if (!conv) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const body = await request.json();

    const [updated] = await db
      .update(crmMessage)
      .set({ ...(typeof body.isStarred === "boolean" ? { isStarred: body.isStarred } : {}) })
      .where(eq(crmMessage.id, msgId))
      .returning();

    return NextResponse.json({ message: updated });
  } catch (e) {
    console.error("[CRM] PATCH message failed:", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
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

    // Valida que a mensagem pertence à conversa do tenant atual
    const [conv] = await db
      .select({ id: crmConversation.id })
      .from(crmConversation)
      .where(and(eq(crmConversation.id, id), eq(crmConversation.tenantId, ctx.tenantId)))
      .limit(1);
    if (!conv) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const [deleted] = await db
      .delete(crmMessage)
      .where(and(eq(crmMessage.id, msgId), eq(crmMessage.conversationId, id)))
      .returning({ id: crmMessage.id });

    if (!deleted) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });

    return NextResponse.json({ ok: true, id: deleted.id });
  } catch (e) {
    console.error("[CRM] DELETE message failed:", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
