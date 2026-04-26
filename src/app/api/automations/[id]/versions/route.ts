/**
 * GET /api/automations/[id]/versions
 * Lista o histórico de versões dos steps de uma automação (mais recente primeiro).
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation, automationStepVersion } from "@/lib/db/schema/automations";
import { user } from "@/lib/db/schema/users";
import { eq, and, desc } from "drizzle-orm";
import type { UserRole } from "@/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canView = await checkPermission(ctx.userId, ctx.role as UserRole, "automations", "view", ctx);
    if (!canView) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    // Garante que a automation pertence ao tenant
    const [auto] = await db
      .select({ id: automation.id })
      .from(automation)
      .where(and(eq(automation.id, id), eq(automation.tenantId, ctx.tenantId)))
      .limit(1);
    if (!auto) return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });

    const rows = await db
      .select({
        id: automationStepVersion.id,
        stepId: automationStepVersion.stepId,
        config: automationStepVersion.config,
        stepType: automationStepVersion.stepType,
        note: automationStepVersion.note,
        createdBy: automationStepVersion.createdBy,
        createdByName: user.name,
        createdAt: automationStepVersion.createdAt,
      })
      .from(automationStepVersion)
      .leftJoin(user, eq(user.id, automationStepVersion.createdBy))
      .where(eq(automationStepVersion.automationId, id))
      .orderBy(desc(automationStepVersion.createdAt))
      .limit(100);

    return NextResponse.json({
      versions: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[VERSIONS] GET", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
