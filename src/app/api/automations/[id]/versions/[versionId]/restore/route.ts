/**
 * POST /api/automations/[id]/versions/[versionId]/restore
 *
 * Restaura uma versão do histórico — cria um novo snapshot da versão ATUAL
 * (pra poder voltar) + sobrescreve o step atual com a config da versão alvo.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  automation,
  automationStep,
  automationStepVersion,
} from "@/lib/db/schema/automations";
import { eq, and } from "drizzle-orm";
import type { UserRole } from "@/types";

export async function POST(
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

    // Busca versão alvo
    const [version] = await db
      .select()
      .from(automationStepVersion)
      .where(
        and(
          eq(automationStepVersion.id, versionId),
          eq(automationStepVersion.automationId, id)
        )
      )
      .limit(1);
    if (!version) return NextResponse.json({ error: "Versão não encontrada" }, { status: 404 });

    // Busca step atual (se ainda existe — stepId pode ter sido deletado)
    const [currentStep] = await db
      .select()
      .from(automationStep)
      .where(eq(automationStep.id, version.stepId))
      .limit(1);

    if (!currentStep) {
      // Step foi deletado — cria novo com o config da versão
      await db.insert(automationStep).values({
        automationId: id,
        order: 1,
        type: version.stepType,
        config: version.config,
      });
      return NextResponse.json({ ok: true, restored: true, recreated: true });
    }

    // Snapshot do estado atual antes de sobrescrever
    await db.insert(automationStepVersion).values({
      stepId: currentStep.id,
      automationId: id,
      config: currentStep.config,
      stepType: currentStep.type,
      createdBy: ctx.userId,
      note: `Snapshot automático antes de restaurar versão de ${version.createdAt.toISOString()}`,
    });

    // Aplica config da versão
    await db
      .update(automationStep)
      .set({ config: version.config, type: version.stepType })
      .where(eq(automationStep.id, currentStep.id));

    return NextResponse.json({ ok: true, restored: true });
  } catch (e) {
    console.error("[VERSIONS] restore failed", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
