/**
 * Teste E2E pra fluxo de follow-up:
 *  1. Welcome (first_message) → triggerFirstMessage agenda
 *  2. processPendingAutomations envia welcome em DRY_RUN
 *  3. Após welcome, conversation tem lastOutgoingAt → começa ciclo
 *  4. Avança o relógio (setando lastOutgoingAt no passado)
 *  5. scheduleInactiveLeadFollowups agenda follow-up
 *  6. processPendingAutomations envia follow-up
 *  7. Botão "Disparar agora": força retry de logs failed
 *
 * Tudo em DRY_RUN — não envia mensagens reais.
 *
 * Usage: npx tsx scripts/test-followup-uazapi.ts
 */

import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
process.env.AUTOMATION_DRY_RUN = "true";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, inArray } from "drizzle-orm";
import { tenant } from "../src/lib/db/schema/tenants";
import { whatsappNumber, crmConversation, crmMessage } from "../src/lib/db/schema/crm";
import { automation, automationStep, automationLog } from "../src/lib/db/schema/automations";
import { pipeline, pipelineStage, lead } from "../src/lib/db/schema/pipeline";
import {
  triggerFirstMessage,
  scheduleInactiveLeadFollowups,
  processPendingAutomations,
} from "../src/lib/automations/runner";

const GH = "00000000-0000-0000-0000-000000000001";

const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
});
const db = drizzle(sql);

const created = {
  automations: [] as string[],
  leads: [] as string[],
  convs: [] as string[],
  stages: [] as string[],
  pipelines: [] as string[],
  wn: null as string | null,
};

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function cleanup() {
  console.log("\n→ Cleanup...");
  try {
    for (const aid of created.automations) {
      await db.delete(automationLog).where(eq(automationLog.automationId, aid));
      await db.delete(automationStep).where(eq(automationStep.automationId, aid));
      await db.delete(automation).where(eq(automation.id, aid));
    }
    for (const lid of created.leads) {
      await db.delete(automationLog).where(eq(automationLog.leadId, lid));
    }
    for (const cid of created.convs) {
      await db.delete(crmMessage).where(eq(crmMessage.conversationId, cid));
    }
    for (const lid of created.leads) {
      await db.delete(lead).where(eq(lead.id, lid));
    }
    for (const cid of created.convs) {
      await db.delete(crmConversation).where(eq(crmConversation.id, cid));
    }
    for (const s of created.stages) {
      await db.delete(pipelineStage).where(eq(pipelineStage.id, s));
    }
    for (const p of created.pipelines) {
      await db.delete(pipeline).where(eq(pipeline.id, p));
    }
    if (created.wn) {
      await db.delete(whatsappNumber).where(eq(whatsappNumber.id, created.wn));
    }
    console.log("  ✓ cleanup");
  } catch (e) {
    console.error("  ✗ cleanup falhou:", e);
  }
}

async function main() {
  console.log("=== Teste E2E: welcome → follow-up → retry ===\n");
  console.log("DRY_RUN:", process.env.AUTOMATION_DRY_RUN);

  // ── Setup ──
  const [gh] = await db.select().from(tenant).where(eq(tenant.id, GH)).limit(1);
  if (!gh) {
    console.error("Tenant GH não existe — rode seed");
    process.exit(1);
  }

  const rand = Math.floor(Math.random() * 1_000_000);
  const testPhone = `999${rand.toString().padStart(7, "0")}`;
  const leadPhone = `5511${rand.toString().padStart(8, "0")}`;

  const [wn] = await db
    .insert(whatsappNumber)
    .values({
      tenantId: GH,
      label: `TEST_e2e_${rand}`,
      phoneNumber: testPhone,
      uazapiSession: `e2e-test-${rand}`,
      uazapiToken: "mock-token",
      isActive: true,
    })
    .returning({ id: whatsappNumber.id });
  created.wn = wn.id;

  const [pipe] = await db
    .insert(pipeline)
    .values({ tenantId: GH, name: "e2e test" })
    .returning({ id: pipeline.id });
  created.pipelines.push(pipe.id);

  const [stage] = await db
    .insert(pipelineStage)
    .values({ tenantId: GH, pipelineId: pipe.id, name: "Novo", order: 0 })
    .returning({ id: pipelineStage.id });
  created.stages.push(stage.id);

  const [conv] = await db
    .insert(crmConversation)
    .values({
      tenantId: GH,
      whatsappNumberId: wn.id,
      contactPhone: leadPhone,
      contactJid: `${leadPhone}@s.whatsapp.net`,
      isGroup: false,
    })
    .returning({ id: crmConversation.id });
  created.convs.push(conv.id);

  const [lid] = await db
    .insert(lead)
    .values({
      tenantId: GH,
      name: "TestE2E",
      phone: leadPhone,
      stageId: stage.id,
      source: "inbound",
      crmConversationId: conv.id,
    })
    .returning({ id: lead.id });
  created.leads.push(lid.id);

  console.log(`Setup: lead=${lid.id.slice(0, 8)} conv=${conv.id.slice(0, 8)}`);

  // ── PARTE 1: Welcome ──
  console.log("\n── PARTE 1: Welcome (first_message) ──");
  const [welcomeAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH,
      name: "e2e-welcome",
      triggerType: "first_message",
      triggerConfig: {},
      isActive: true,
      dryRun: true,
    })
    .returning({ id: automation.id });
  created.automations.push(welcomeAuto.id);

  await db.insert(automationStep).values({
    automationId: welcomeAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Olá {{nome}}! Welcome." },
  });

  // Trigger welcome
  const w1 = await triggerFirstMessage({ tenantId: GH, leadId: lid.id });
  check("[1] triggerFirstMessage agendou 1 log", w1.scheduled === 1, `scheduled=${w1.scheduled}`);

  // Process
  const p1 = await processPendingAutomations(50);
  check("[2] processPendingAutomations enviou welcome", p1.sent === 1, `sent=${p1.sent} failed=${p1.failed}`);

  // Verify conversation got lastOutgoingAt set
  const [c1] = await db
    .select({ out: crmConversation.lastOutgoingAt })
    .from(crmConversation)
    .where(eq(crmConversation.id, conv.id))
    .limit(1);
  check("[3] welcome atualizou lastOutgoingAt → ciclo de follow-up começou", !!c1.out, `lastOutgoingAt=${c1.out?.toISOString()}`);

  // ── PARTE 2: Follow-up ──
  console.log("\n── PARTE 2: Follow-up (lead_inactive) ──");
  const [followAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH,
      name: "e2e-followup",
      triggerType: "lead_inactive",
      triggerConfig: { inactiveMinutes: 1 },
      isActive: true,
      dryRun: true,
    })
    .returning({ id: automation.id });
  created.automations.push(followAuto.id);

  await db.insert(automationStep).values({
    automationId: followAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Followup {{nome}}!" },
  });

  // Avança lastOutgoingAt 2 minutos atrás (passa do threshold de 1min)
  await db
    .update(crmConversation)
    .set({ lastOutgoingAt: new Date(Date.now() - 2 * 60_000) })
    .where(eq(crmConversation.id, conv.id));

  // Schedule
  const s1 = await scheduleInactiveLeadFollowups({ tenantId: GH });
  check("[4] scheduleInactive agendou 1 follow-up pro lead", s1.scheduled >= 1, `scheduled=${s1.scheduled} eligible=${s1.eligible}`);

  const followLogsBeforeProcess = await db
    .select()
    .from(automationLog)
    .where(and(eq(automationLog.automationId, followAuto.id), eq(automationLog.leadId, lid.id)));
  check("[5] log do follow-up está pending", followLogsBeforeProcess.length === 1 && followLogsBeforeProcess[0].status === "pending",
    `count=${followLogsBeforeProcess.length} status=${followLogsBeforeProcess[0]?.status}`);

  // Snapshot lastOutgoingAt right before processing (testar loop-proof)
  const [convPre] = await db
    .select({ out: crmConversation.lastOutgoingAt })
    .from(crmConversation)
    .where(eq(crmConversation.id, conv.id))
    .limit(1);
  const expectedOutAt = convPre.out;

  // Process — limita a 50 (o teste roda em DRY_RUN então eventuais logs do
  // user serão processados em modo dry — nada de envio real)
  const p2 = await processPendingAutomations(50);
  check("[6] processPendingAutomations enviou follow-up", p2.sent >= 1, `sent=${p2.sent} failed=${p2.failed}`);

  const followLogsAfterProcess = await db
    .select()
    .from(automationLog)
    .where(and(eq(automationLog.automationId, followAuto.id), eq(automationLog.leadId, lid.id)));
  check("[7] log do follow-up está sent", followLogsAfterProcess[0]?.status === "sent",
    `status=${followLogsAfterProcess[0]?.status} error=${followLogsAfterProcess[0]?.error}`);

  // Verify lastOutgoingAt NOT updated (loop-proof) — comparado ao snapshot pre-process
  const [c2] = await db
    .select({ out: crmConversation.lastOutgoingAt })
    .from(crmConversation)
    .where(eq(crmConversation.id, conv.id))
    .limit(1);
  check("[8] follow-up NÃO atualizou lastOutgoingAt (loop-proof)",
    c2.out?.getTime() === expectedOutAt?.getTime(),
    `outAt=${c2.out?.toISOString()} expected=${expectedOutAt?.toISOString()}`);

  // ── PARTE 3: Retry de failed ──
  console.log("\n── PARTE 3: Retry de logs failed (Disparar agora) ──");
  // Desativa followAuto pra que retryAuto seja a única (chain[0]) nas próximas partes
  await db
    .update(automation)
    .set({ isActive: false })
    .where(eq(automation.id, followAuto.id));

  // Cria outra automation pra simular failed
  const [retryAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH,
      name: "e2e-retry",
      triggerType: "lead_inactive",
      triggerConfig: { inactiveMinutes: 1 },
      isActive: true,
      dryRun: true,
    })
    .returning({ id: automation.id });
  created.automations.push(retryAuto.id);

  await db.insert(automationStep).values({
    automationId: retryAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Retry {{nome}}" },
  });

  // Reset cycle: novo lastOutgoingAt mas mantém lead como inativo
  await db
    .update(crmConversation)
    .set({
      lastOutgoingAt: new Date(Date.now() - 2 * 60_000),
      lastIncomingAt: null,
    })
    .where(eq(crmConversation.id, conv.id));
  // Limpa logs de cycle anterior
  await db.delete(automationLog).where(
    and(eq(automationLog.leadId, lid.id), inArray(automationLog.automationId, [followAuto.id, retryAuto.id]))
  );

  // Schedule + force log to failed (simula bug antigo)
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  await db
    .update(automationLog)
    .set({ status: "failed", error: "simulando bug uazapi", executedAt: new Date() })
    .where(and(eq(automationLog.automationId, retryAuto.id), eq(automationLog.leadId, lid.id)));

  const beforeRetry = await db
    .select()
    .from(automationLog)
    .where(and(eq(automationLog.automationId, retryAuto.id), eq(automationLog.leadId, lid.id)));
  check("[9] Setup retry: 1 log failed criado",
    beforeRetry.length === 1 && beforeRetry[0].status === "failed",
    `count=${beforeRetry.length} status=${beforeRetry[0]?.status}`);

  // Simula "Disparar agora" — deleta failed/skipped, depois reagenda
  await db
    .delete(automationLog)
    .where(
      and(
        eq(automationLog.automationId, retryAuto.id),
        inArray(automationLog.status, ["failed", "skipped"])
      )
    );
  const s3 = await scheduleInactiveLeadFollowups({ tenantId: GH });
  check("[10] Após clear+schedule, follow-up retry foi agendado", s3.scheduled >= 1, `scheduled=${s3.scheduled}`);

  const p3 = await processPendingAutomations(50);
  check("[11] Retry foi processado e enviado", p3.sent >= 1, `sent=${p3.sent} failed=${p3.failed}`);

  const afterRetry = await db
    .select()
    .from(automationLog)
    .where(and(eq(automationLog.automationId, retryAuto.id), eq(automationLog.leadId, lid.id)));
  check("[12] Log retry tem status=sent (sem o failed antigo)",
    afterRetry.length === 1 && afterRetry[0].status === "sent",
    `count=${afterRetry.length} statuses=${afterRetry.map((l) => l.status).join(",")}`);

  // ── PARTE 4: Backoff retry automático no ticker ──
  console.log("\n── PARTE 4: Backoff automático (failed > 5min → retry) ──");
  // Reset cycle
  await db
    .update(crmConversation)
    .set({
      lastOutgoingAt: new Date(Date.now() - 10 * 60_000),
      lastIncomingAt: null,
    })
    .where(eq(crmConversation.id, conv.id));
  await db.delete(automationLog).where(eq(automationLog.leadId, lid.id));

  // Cria log failed antigo (>5min)
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  await db
    .update(automationLog)
    .set({
      status: "failed",
      error: "old bug",
      executedAt: new Date(Date.now() - 6 * 60_000), // 6min atrás
    })
    .where(and(eq(automationLog.automationId, retryAuto.id), eq(automationLog.leadId, lid.id)));

  // Schedule deve PURGAR o failed antigo e re-agendar
  const s4 = await scheduleInactiveLeadFollowups({ tenantId: GH });
  check("[13] Backoff: failed >5min purgado e re-agendado pelo ticker normal",
    s4.scheduled >= 1, `scheduled=${s4.scheduled}`);

  const afterBackoff = await db
    .select()
    .from(automationLog)
    .where(and(eq(automationLog.automationId, retryAuto.id), eq(automationLog.leadId, lid.id)));
  check("[14] Apenas 1 log existe pro retryAuto (purgado)",
    afterBackoff.length === 1 && afterBackoff[0].status === "pending",
    `count=${afterBackoff.length} statuses=${afterBackoff.map((l) => l.status).join(",")}`);

  // ── PARTE 5: Failed recente (<5min) bloqueia ticker ──
  console.log("\n── PARTE 5: Failed recente (<5min) bloqueia retry ticker ──");
  // Reset cycle
  await db
    .update(crmConversation)
    .set({
      lastOutgoingAt: new Date(Date.now() - 10 * 60_000),
      lastIncomingAt: null,
    })
    .where(eq(crmConversation.id, conv.id));
  await db.delete(automationLog).where(eq(automationLog.leadId, lid.id));

  await scheduleInactiveLeadFollowups({ tenantId: GH });
  await db
    .update(automationLog)
    .set({
      status: "failed",
      error: "recent fail",
      executedAt: new Date(Date.now() - 2 * 60_000), // 2min atrás (<5min)
    })
    .where(and(eq(automationLog.automationId, retryAuto.id), eq(automationLog.leadId, lid.id)));

  // Schedule não deve re-agendar (failed recente bloqueia)
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const recentFailLogs = await db
    .select()
    .from(automationLog)
    .where(and(eq(automationLog.automationId, retryAuto.id), eq(automationLog.leadId, lid.id)));
  check("[15] Failed recente: ticker NÃO re-agenda (1 log apenas)",
    recentFailLogs.length === 1 && recentFailLogs[0].status === "failed",
    `count=${recentFailLogs.length} statuses=${recentFailLogs.map((l) => l.status).join(",")}`);

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passou / ${failed} falhou`);
  await cleanup();
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n❌ FATAL:", e);
  await cleanup().catch(() => {});
  await sql.end().catch(() => {});
  process.exit(1);
});
