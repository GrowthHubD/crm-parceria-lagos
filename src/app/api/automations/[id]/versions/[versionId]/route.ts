/**
 * DELETE /api/automations/[id]/versions/[versionId]
 * Remove permanentemente uma versão do histórico.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation, automationStepVersion } from "@/lib/db/schema/automations";
import { eq, and } from "drizzle-orm";
import type { UserRole } from "@/types";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { id, versionId } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "automations", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    // Tenant check
    const [auto] = await db
      .select({ id: automation.id })
      .from(automation)
      .where(and(eq(automation.id, id), eq(automation.tenantId, ctx.tenantId)))
      .limit(1);
    if (!auto) return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });

    const [deleted] = await db
      .delete(automationStepVersion)
      .where(
        and(
          eq(automationStepVersion.id, versionId),
          eq(automationStepVersion.automationId, id)
        )
      )
      .returning({ id: automationStepVersion.id });

    if (!deleted) return NextResponse.json({ error: "Versão não encontrada" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[VERSIONS] delete failed", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
