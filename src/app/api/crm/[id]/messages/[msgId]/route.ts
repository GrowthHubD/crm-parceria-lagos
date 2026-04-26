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
