/**
 * Parte node-only do instrumentation — separada pra não contaminar edge runtime build.
 */
import { startAutomationTicker } from "@/lib/automations/tick";

if (process.env.AUTOMATION_TICK_DISABLED !== "true") {
  startAutomationTicker({ intervalMs: 30_000 });
  console.log("[AUTOMATIONS] ticker iniciado (30s)");
}
