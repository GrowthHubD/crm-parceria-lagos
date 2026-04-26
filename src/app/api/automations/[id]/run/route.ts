/**
 * POST /api/automations/[id]/run
 *
 * Força disparo imediato de uma automação, sem esperar cron.
 * - lead_inactive: agenda follow-up pra todos leads elegíveis + processa pendentes
 * - scheduled_once / scheduled_recurring: ignora "runAt" e dispara agora
 * - manual_broadcast: dispara broadcast (mesma coisa que /broadcast)
 *
 * Uso: botão "Disparar agora" em cards de follow-up.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation, automationLog } from "@/lib/db/schema/automations";
import { eq, and, inArray } from "drizzle-orm";
import {
  scheduleInactiveLeadFollowups,
  triggerBroadcast,
  processPendingAutomations,
} from "@/lib/automations/runner";
import type { UserRole } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "automations", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const [auto] = await db
      .select()
      .from(automation)
      .where(and(eq(automation.id, id), eq(automation.tenantId, ctx.tenantId)))
      .limit(1);

    if (!auto) return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });
    if (!auto.isActive) return NextResponse.json({ error: "Automação está desativada" }, { status: 400 });

    let scheduled = 0;
    let targeted = 0;
    let evaluated = 0;
    let eligible = 0;

    if (auto.triggerType === "lead_inactive") {
      // "Disparar agora" = força retry. Logs `failed`/`skipped` na cadeia bloqueiam
      // o agendamento normal (chain logic) — limpamos eles pra que o `schedule…`
      // possa re-agendar o step. Não tocamos em `pending`/`processing`/`sent` pra
      // evitar duplicar envios em flight ou já realizados no ciclo.
      const cleared = await db
        .delete(automationLog)
        .where(
          and(
            eq(automationLog.automationId, id),
            inArray(automationLog.status, ["failed", "skipped"])
          )
        )
        .returning({ id: automationLog.id });
      const r = await scheduleInactiveLeadFollowups({ tenantId: ctx.tenantId });
      scheduled = r.scheduled;
      evaluated = r.evaluated;
      eligible = r.eligible;
      targeted = r.scheduled;
      console.log(
        `[AUTOMATION RUN] auto=${id} cleared_failed=${cleared.length} scheduled=${r.scheduled} eligible=${r.eligible}`
      );
    } else if (auto.triggerType === "manual_broadcast" || auto.triggerType === "scheduled_once" || auto.triggerType === "scheduled_recurring") {
      const r = await triggerBroadcast({ automationId: id });
      scheduled = r.scheduled;
      targeted = r.targeted;
    } else {
      return NextResponse.json({
        error: `Tipo "${auto.triggerType}" não suporta disparo manual (usado em eventos automáticos)`,
      }, { status: 400 });
    }

    const processed = await processPendingAutomations(500);

    return NextResponse.json({
      ok: true,
      triggerType: auto.triggerType,
      targeted,
      scheduled,
      evaluated,
      eligible,
      sent: processed.sent,
      failed: processed.failed,
      skipped: processed.skipped,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    console.error("[AUTOMATION RUN]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
