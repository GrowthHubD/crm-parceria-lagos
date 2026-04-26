/**
 * Cron endpoint — tick de automações.
 *
 * Chamado periodicamente (recomendado: a cada 5-15 min):
 *   POST /api/cron/follow-up
 *   Header: Authorization: Bearer ${CRON_SECRET}
 *
 * Faz:
 *   1. scheduleInactiveLeadFollowups() — enfileira follow-ups pra leads abandonados
 *   2. runScheduledAutomations()       — dispara scheduled_once/recurring que devem rodar agora
 *   3. processPendingAutomations()     — envia todos os logs pendentes
 *
 * Como a lógica de "should run" do recorrente olha hora:minuto + dedup de 23h,
 * rodar a cada 5-15 min é seguro (não dispara 2x o mesmo slot).
 */
import { NextRequest, NextResponse } from "next/server";
import { runAutomationTick } from "@/lib/automations/tick";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const r = await runAutomationTick();
    return NextResponse.json({
      ok: true,
      inactive_scheduled: r.inactiveScheduled,
      scheduled_fired: r.scheduledFired,
      scheduled_logs: r.scheduledLogs,
      processed: r.processed,
      sent: r.sent,
      failed: r.failed,
      skipped: r.skipped,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    console.error("[CRON TICK]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
