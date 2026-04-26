/**
 * Orquestração periódica de automações.
 *
 * `runAutomationTick()` — uma iteração (schedule inactive + run scheduled + process pending).
 * `startAutomationTicker({ intervalMs })` — setInterval que chama o tick.
 * `stopAutomationTicker()` — limpa o handle.
 *
 * Chamado por:
 *   - `src/instrumentation.ts` no boot do Next (dev + single-node prod)
 *   - `/api/cron/follow-up` quando chamado externamente (Cloudflare Workers Cron etc)
 *
 * Arquitetura modular (feature-sliced): toda a lógica de automação vive
 * dentro de `src/lib/automations/`.
 */
import {
  scheduleInactiveLeadFollowups,
  runScheduledAutomations,
  processPendingAutomations,
} from "./runner";

export interface TickResult {
  inactiveScheduled: number;
  scheduledFired: number;
  scheduledLogs: number;
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Uma iteração do tick — reutilizada pelo cron endpoint + ticker interno.
 */
export async function runAutomationTick(): Promise<TickResult> {
  const inactive = await scheduleInactiveLeadFollowups({});
  const scheduled = await runScheduledAutomations({});
  const processed = await processPendingAutomations(500);

  return {
    inactiveScheduled: inactive.scheduled,
    scheduledFired: scheduled.fired,
    scheduledLogs: scheduled.totalScheduled,
    processed: processed.processed,
    sent: processed.sent,
    failed: processed.failed,
    skipped: processed.skipped,
  };
}

// ─────────────────────────────────────────────────────────
// Ticker singleton — roda no server Node.js
// ─────────────────────────────────────────────────────────

let tickHandle: NodeJS.Timeout | null = null;
let ticking = false; // previne overlap se um tick demora mais que o interval

export function startAutomationTicker(opts: { intervalMs?: number } = {}): void {
  if (tickHandle) return; // já iniciado

  const interval = opts.intervalMs ?? 30_000;

  const tick = async () => {
    if (ticking) return; // skip se ainda processando o anterior
    ticking = true;
    try {
      const r = await runAutomationTick();
      // Só loga se teve atividade — evita poluir console com 0/0/0
      if (r.sent > 0 || r.failed > 0 || r.inactiveScheduled > 0 || r.scheduledFired > 0) {
        console.log(
          `[TICK] sent=${r.sent} failed=${r.failed} inactive_sched=${r.inactiveScheduled} scheduled_fired=${r.scheduledFired}`
        );
      }
    } catch (e) {
      console.error("[TICK] erro:", e instanceof Error ? e.message : e);
    } finally {
      ticking = false;
    }
  };

  tickHandle = setInterval(tick, interval);

  // Roda uma vez imediato pra não esperar o primeiro interval
  tick().catch(() => {});
}

export function stopAutomationTicker(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}
