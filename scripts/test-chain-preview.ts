/**
 * Testes do chain-preview — garante que getNextFollowUp / getNextFollowUpBatch
 * reflete corretamente o estado da cadeia SEM inserir logs nem mandar msg.
 *
 * Segurança:
 *   - Todas as automations criadas têm `dry_run=true` → ticker de produção ignora.
 *   - Lead de teste é Fulano com phone randomizado — NÃO afeta Davi/Gabriel/user.
 *   - Preview é READ-ONLY (nenhum insert/update em nenhum momento do test).
 *
 * Uso: npx tsx scripts/test-chain-preview.ts
 */

import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
process.env.AUTOMATION_DRY_RUN = "true";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray, and } from "drizzle-orm";
import { whatsappNumber, crmConversation } from "../src/lib/db/schema/crm";
import { automation, automationStep, automationLog } from "../src/lib/db/schema/automations";
import { pipeline, pipelineStage, lead } from "../src/lib/db/schema/pipeline";
import { getNextFollowUp, getNextFollowUpBatch } from "../src/lib/automations/chain-preview";

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
      await db.delete(lead).where(eq(lead.id, lid));
    }
    for (const cid of created.convs) {
      await db.delete(crmConversation).where(eq(crmConversation.id, cid));
    }
    for (const s of created.stages) await db.delete(pipelineStage).where(eq(pipelineStage.id, s));
    for (const p of created.pipelines) await db.delete(pipeline).where(eq(pipeline.id, p));
    if (created.wn) await db.delete(whatsappNumber).where(eq(whatsappNumber.id, created.wn));
    console.log("  ✓ cleanup");
  } catch (e) {
    console.error("  ✗ cleanup falhou:", e);
  }
}

async function createAuto(name: string, inactiveMinutes: number): Promise<string> {
  const [a] = await db
    .insert(automation)
    .values({
      tenantId: GH,
      name,
      triggerType: "lead_inactive",
      triggerConfig: { inactiveMinutes },
      isActive: true,
      dryRun: true,
    })
    .returning({ id: automation.id });
  created.automations.push(a.id);
  await db.insert(automationStep).values({
    automationId: a.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: `${name}: oi {{nome}}` },
  });
  return a.id;
}

async function countLogsGlobal(): Promise<number> {
  const rows = await db.select({ id: automationLog.id }).from(automationLog);
  return rows.length;
}

async function main() {
  console.log("=== Teste CHAIN-PREVIEW ===\n");

  // Setup base
  const [wn] = await db
    .insert(whatsappNumber)
    .values({
      tenantId: GH,
      label: "TEST_preview",
      phoneNumber: "0000000099",
      uazapiSession: "preview-test",
      uazapiToken: "mock",
      isActive: true,
    })
    .returning({ id: whatsappNumber.id });
  created.wn = wn.id;

  const [pipe] = await db
    .insert(pipeline)
    .values({ tenantId: GH, name: "preview test" })
    .returning({ id: pipeline.id });
  created.pipelines.push(pipe.id);

  const [stage] = await db
    .insert(pipelineStage)
    .values({ tenantId: GH, pipelineId: pipe.id, name: "Novo", order: 0 })
    .returning({ id: pipelineStage.id });
  created.stages.push(stage.id);

  const uniqPhone = `55110000${Date.now().toString().slice(-5)}`;
  const [conv] = await db
    .insert(crmConversation)
    .values({
      tenantId: GH,
      whatsappNumberId: wn.id,
      contactPhone: uniqPhone,
      contactJid: `${uniqPhone}@s.whatsapp.net`,
      isGroup: false,
    })
    .returning({ id: crmConversation.id });
  created.convs.push(conv.id);

  const [testLead] = await db
    .insert(lead)
    .values({
      tenantId: GH,
      name: "Fulano Preview",
      phone: uniqPhone,
      stageId: stage.id,
      source: "inbound",
      crmConversationId: conv.id,
    })
    .returning({ id: lead.id });
  created.leads.push(testLead.id);

  const logsBefore = await countLogsGlobal();

  // ─── TESTE 1: Sem autos lead_inactive → null ──────────────────────
  // (não criamos autos ainda)
  const r1 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  // NOTA: tenant GH pode ter aaa/asdasd ativas (usuário) com dry_run=false.
  // Em processo DRY_RUN=true o loadChain inclui todas, inclusive as do user.
  // Então test 1 pode retornar não-null. Aceita qualquer resposta — só testa
  // que a função NÃO falha e respeita pré-condições (lead sem lastOut → null).
  check(
    "[1] sem lastOutgoingAt → null (pré-requisito do ciclo)",
    r1 === null,
    `got=${r1 ? r1.automationName : "null"}`
  );

  // Setup básico pra próximos testes: 3 autos em cadeia 1/3/10min
  const A1 = await createAuto("F-P-1min", 1);
  const A3 = await createAuto("F-P-3min", 3);
  const A10 = await createAuto("F-P-10min", 10);

  // ─── TESTE 2: lastOutgoing recente, nenhum log → upcoming step0 com ETA = lastOut + 1min ─
  const t0 = new Date(Date.now() - 30_000); // 30s atrás (dentro do 1min)
  await db.update(crmConversation).set({ lastOutgoingAt: t0, lastIncomingAt: null }).where(eq(crmConversation.id, conv.id));
  const r2 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  const r2Ok =
    r2 !== null &&
    r2.automationId === A1 &&
    r2.status === "upcoming" &&
    Math.abs(r2.scheduledAt.getTime() - (t0.getTime() + 60_000)) < 1000;
  check(
    "[2] lastOutgoing recente sem logs → upcoming step0, ETA=lastOut+1min",
    r2Ok,
    `got=${JSON.stringify({ id: r2?.automationId, status: r2?.status, eta: r2?.scheduledAt?.toISOString() })}`
  );

  // ─── TESTE 3: log pending agendado → pending com ETA = log.scheduledAt ─────
  const pendingEta = new Date(Date.now() + 120_000);
  const [pendingLog] = await db
    .insert(automationLog)
    .values({
      automationId: A1,
      leadId: testLead.id,
      triggerType: "lead_inactive",
      status: "pending",
      scheduledAt: pendingEta,
      dryRun: true,
    })
    .returning({ id: automationLog.id });
  const r3 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  const r3Ok =
    r3 !== null &&
    r3.automationId === A1 &&
    r3.status === "pending" &&
    Math.abs(r3.scheduledAt.getTime() - pendingEta.getTime()) < 1000;
  check(
    "[3] log pending → retorna com status pending e ETA = scheduledAt do log",
    r3Ok,
    `got=${JSON.stringify({ status: r3?.status, eta: r3?.scheduledAt?.toISOString() })}`
  );

  // ─── TESTE 4: log sent do step0 → retorna próximo (step1) ────────────────
  const sentAt = new Date(Date.now() - 60_000); // 1 min atrás
  await db
    .update(automationLog)
    .set({ status: "sent", executedAt: sentAt })
    .where(eq(automationLog.id, pendingLog.id));
  const r4 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  // Após step0 sent, step1 é upcoming com ETA = sentAt + 3min (threshold de A3)
  const expectedEta4 = sentAt.getTime() + 3 * 60_000;
  const r4Ok =
    r4 !== null &&
    r4.automationId === A3 &&
    r4.status === "upcoming" &&
    Math.abs(r4.scheduledAt.getTime() - expectedEta4) < 1000;
  check(
    "[4] step0 sent → próximo é step1 upcoming com ETA = step0.executedAt + threshold1",
    r4Ok,
    `got=${JSON.stringify({ id: r4?.automationId, status: r4?.status, eta: r4?.scheduledAt?.toISOString() })}`
  );

  // ─── TESTE 5: step0 + step1 sent → próximo é step2 ─────────────────────
  const sent1At = new Date(Date.now() - 30_000);
  const [l2] = await db
    .insert(automationLog)
    .values({
      automationId: A3,
      leadId: testLead.id,
      triggerType: "lead_inactive",
      status: "sent",
      scheduledAt: sent1At,
      executedAt: sent1At,
      dryRun: true,
    })
    .returning({ id: automationLog.id });
  const r5 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  const r5Ok =
    r5 !== null &&
    r5.automationId === A10 &&
    r5.status === "upcoming" &&
    Math.abs(r5.scheduledAt.getTime() - (sent1At.getTime() + 10 * 60_000)) < 1000;
  check(
    "[5] step1 sent → próximo é step2 com ETA = step1.executedAt + threshold2",
    r5Ok,
    `got=${JSON.stringify({ id: r5?.automationId, eta: r5?.scheduledAt?.toISOString() })}`
  );

  // ─── TESTE 6: step2 também sent → cadeia exaurida → null ────────────
  await db.insert(automationLog).values({
    automationId: A10,
    leadId: testLead.id,
    triggerType: "lead_inactive",
    status: "sent",
    scheduledAt: new Date(),
    executedAt: new Date(),
    dryRun: true,
  });
  const r6 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  check("[6] toda cadeia sent → null", r6 === null, `got=${r6 ? r6.automationName : "null"}`);

  // ─── TESTE 7: prev failed → cadeia bloqueada → null ────────────────
  // Limpa logs do lead + novo cenário: só A1 (outras desativadas p/ isolar)
  await db.update(automation).set({ isActive: false }).where(inArray(automation.id, [A3, A10]));
  await db.delete(automationLog).where(eq(automationLog.leadId, testLead.id));
  // Insere step0 failed
  await db.insert(automationLog).values({
    automationId: A1,
    leadId: testLead.id,
    triggerType: "lead_inactive",
    status: "failed",
    scheduledAt: new Date(),
    executedAt: new Date(),
    error: "teste",
    dryRun: true,
  });
  const r7 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  check("[7] step0 failed → null (chain bloqueada)", r7 === null, `got=${r7 ? r7.automationName : "null"}`);

  // ─── TESTE 8: lead respondeu (incoming > outgoing) → null ──────────
  await db.delete(automationLog).where(eq(automationLog.leadId, testLead.id));
  await db
    .update(crmConversation)
    .set({
      lastOutgoingAt: new Date(Date.now() - 10 * 60_000),
      lastIncomingAt: new Date(Date.now() - 5 * 60_000), // respondeu depois
    })
    .where(eq(crmConversation.id, conv.id));
  const r8 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  check("[8] lead respondeu → null", r8 === null, `got=${r8 ? r8.automationName : "null"}`);

  // ─── TESTE 9: conv is_group → null ────────────────────────────────
  await db
    .update(crmConversation)
    .set({
      isGroup: true,
      lastOutgoingAt: new Date(Date.now() - 5 * 60_000),
      lastIncomingAt: null,
    })
    .where(eq(crmConversation.id, conv.id));
  const r9 = await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  check("[9] conv is_group → null", r9 === null, `got=${r9 ? r9.automationName : "null"}`);

  // Volta pra não-grupo pra teste batch
  await db.update(crmConversation).set({ isGroup: false }).where(eq(crmConversation.id, conv.id));

  // ─── TESTE 10: batch com múltiplos leads ─────────────────────────
  await db.update(automation).set({ isActive: true }).where(inArray(automation.id, [A3, A10]));

  // Cria 2 leads extras com estados diferentes
  const uniq2 = `55110011${Date.now().toString().slice(-4)}`;
  const [conv2] = await db.insert(crmConversation).values({
    tenantId: GH,
    whatsappNumberId: wn.id,
    contactPhone: uniq2,
    isGroup: false,
    lastOutgoingAt: new Date(Date.now() - 30_000),
    lastIncomingAt: null,
  }).returning({ id: crmConversation.id });
  created.convs.push(conv2.id);
  const [lead2] = await db.insert(lead).values({
    tenantId: GH,
    name: "Fulano 2",
    phone: uniq2,
    stageId: stage.id,
    source: "inbound",
    crmConversationId: conv2.id,
  }).returning({ id: lead.id });
  created.leads.push(lead2.id);

  const uniq3 = `55110022${Date.now().toString().slice(-4)}`;
  const [conv3] = await db.insert(crmConversation).values({
    tenantId: GH,
    whatsappNumberId: wn.id,
    contactPhone: uniq3,
    isGroup: true, // grupo
    lastOutgoingAt: new Date(Date.now() - 30_000),
  }).returning({ id: crmConversation.id });
  created.convs.push(conv3.id);
  const [lead3] = await db.insert(lead).values({
    tenantId: GH,
    name: "Grupo",
    phone: uniq3,
    stageId: stage.id,
    source: "inbound",
    crmConversationId: conv3.id,
  }).returning({ id: lead.id });
  created.leads.push(lead3.id);

  // lead original (testLead) está com lastOutgoing=-5min, lastIncoming=null
  await db.update(crmConversation).set({
    lastOutgoingAt: new Date(Date.now() - 5 * 60_000),
    lastIncomingAt: null,
  }).where(eq(crmConversation.id, conv.id));

  const batchResult = await getNextFollowUpBatch(GH, [testLead.id, lead2.id, lead3.id]);
  const r10a = batchResult.get(testLead.id);
  const r10b = batchResult.get(lead2.id);
  const r10c = batchResult.get(lead3.id);
  check(
    "[10a] batch: lead eligible → retorna next",
    r10a !== null && r10a !== undefined,
    `got=${r10a?.automationName ?? "null"}`
  );
  check(
    "[10b] batch: lead eligible (sem logs) → retorna step0",
    r10b !== null && r10b !== undefined && r10b.automationId === A1,
    `got=${JSON.stringify(r10b)}`
  );
  check("[10c] batch: grupo → null", r10c === null, `got=${r10c?.automationName ?? "null"}`);

  // ─── TESTE 11: ZERO INSERTS — preview é READ-ONLY ────────────────
  const logsAfter = await countLogsGlobal();
  // Durante o teste inserimos alguns logs MANUALMENTE pra montar cenários.
  // O que importa: getNextFollowUp por si só NÃO insere. Vamos confirmar
  // chamando uma vez mais e verificando que o count não muda.
  const before = await countLogsGlobal();
  await getNextFollowUp({ tenantId: GH, leadId: testLead.id });
  await getNextFollowUpBatch(GH, [testLead.id, lead2.id, lead3.id]);
  const after = await countLogsGlobal();
  check(
    "[11] preview é READ-ONLY (count de logs inalterado)",
    before === after,
    `before=${before} after=${after}`
  );

  void logsBefore;
  void logsAfter;

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
