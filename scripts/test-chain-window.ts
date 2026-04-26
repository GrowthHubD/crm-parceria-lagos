/**
 * Testes das NOVAS mudanças em follow-up:
 *   1. Cadeia sequencial (step N só dispara se N-1 já foi sent)
 *   2. Thresholds incrementais (step 2 espera seu threshold desde step1.executedAt)
 *   3. Runner NÃO atualiza lastOutgoingAt (loop-proof)
 *   4. Novo outgoing do operador reseta a cadeia (lastOutgoingAt muda)
 *   5. Lead respondendo bloqueia cadeia (last_incoming > last_outgoing)
 *   6. Janela de horário — dentro permite
 *   7. Janela de horário — fora bloqueia
 *   8. Janela que cruza meia-noite
 *   9. Step anterior failed bloqueia o próximo
 *  10. Sem auto-repetição: step 1 não dispara 2x no mesmo ciclo
 *  11. Cadeia de 3 steps respeita ordem
 *
 * Usage: npx tsx scripts/test-chain-window.ts
 */

import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
// Força DRY_RUN APÓS carregar .env.local (que seta como "false")
process.env.AUTOMATION_DRY_RUN = "true";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, inArray } from "drizzle-orm";
import { tenant } from "../src/lib/db/schema/tenants";
import { whatsappNumber, crmConversation, crmMessage } from "../src/lib/db/schema/crm";
import { automation, automationStep, automationLog } from "../src/lib/db/schema/automations";
import { pipeline, pipelineStage, lead } from "../src/lib/db/schema/pipeline";
import {
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

interface ChainAuto {
  id: string;
  thresholdMs: number;
}

async function createFollowUpAutomation(params: {
  name: string;
  inactiveMinutes?: number;
  inactiveHours?: number;
  sendWindow?: { startHour: number; endHour: number };
}): Promise<ChainAuto> {
  const cfg: Record<string, unknown> = {};
  if (params.inactiveMinutes) cfg.inactiveMinutes = params.inactiveMinutes;
  if (params.inactiveHours) cfg.inactiveHours = params.inactiveHours;
  if (params.sendWindow) cfg.sendWindow = { ...params.sendWindow, timezone: "America/Sao_Paulo" };

  const [auto] = await db
    .insert(automation)
    .values({
      tenantId: GH,
      name: params.name,
      triggerType: "lead_inactive",
      triggerConfig: cfg,
      isActive: true,
      dryRun: true, // invisível pro ticker de produção
    })
    .returning({ id: automation.id });
  created.automations.push(auto.id);

  await db.insert(automationStep).values({
    automationId: auto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: `${params.name}: oi {{nome}}` },
  });

  const thresholdMs =
    (params.inactiveMinutes ?? 0) * 60_000 + (params.inactiveHours ?? 0) * 3_600_000;
  return { id: auto.id, thresholdMs };
}

async function resetLeadLogs(leadId: string, autoIds: string[]) {
  if (autoIds.length === 0) return;
  await db.delete(automationLog).where(
    and(inArray(automationLog.automationId, autoIds), eq(automationLog.leadId, leadId))
  );
}

async function setConvTimes(
  convId: string,
  updates: { lastOutgoingAt?: Date | null; lastIncomingAt?: Date | null }
) {
  await db.update(crmConversation).set(updates).where(eq(crmConversation.id, convId));
}

async function getLogs(leadId: string, autoIds: string[]) {
  if (autoIds.length === 0) return [];
  return await db
    .select()
    .from(automationLog)
    .where(
      and(inArray(automationLog.automationId, autoIds), eq(automationLog.leadId, leadId))
    );
}

async function preCleanup() {
  // Remove restos de execuções anteriores que falharam
  const names = ["F-1min", "F-3min", "F-10min", "F-win-in", "F-win-out", "F-win-null", "F-win-cross-real", "Bx-1min", "By-2min"];
  const oldAutos = await db
    .select({ id: automation.id })
    .from(automation)
    .where(and(eq(automation.tenantId, GH), inArray(automation.name, names)));
  for (const a of oldAutos) {
    await db.delete(automationLog).where(eq(automationLog.automationId, a.id));
    await db.delete(automationStep).where(eq(automationStep.automationId, a.id));
    await db.delete(automation).where(eq(automation.id, a.id));
  }
  // Remove leads "Fulano" órfãos
  const oldLeads = await db
    .select({ id: lead.id, convId: lead.crmConversationId })
    .from(lead)
    .where(and(eq(lead.tenantId, GH), eq(lead.name, "Fulano")));
  for (const l of oldLeads) {
    if (l.convId) {
      await db.delete(crmMessage).where(eq(crmMessage.conversationId, l.convId));
      await db.delete(crmConversation).where(eq(crmConversation.id, l.convId));
    }
    await db.delete(lead).where(eq(lead.id, l.id));
  }
  // Remove whatsapp_numbers órfãos
  const oldWn = await db
    .select({ id: whatsappNumber.id })
    .from(whatsappNumber);
  const toRemoveWn = oldWn.filter(async (w) => {
    const [row] = await db
      .select()
      .from(whatsappNumber)
      .where(eq(whatsappNumber.id, w.id))
      .limit(1);
    return row && (row as { label?: string }).label?.startsWith("TEST_chain");
  });
  // Simpler: delete by label pattern
  const testWns = await db
    .select({ id: whatsappNumber.id, label: whatsappNumber.label })
    .from(whatsappNumber)
    .where(eq(whatsappNumber.tenantId, GH));
  for (const w of testWns) {
    if (w.label?.startsWith("TEST_chain")) {
      await db.delete(whatsappNumber).where(eq(whatsappNumber.id, w.id));
    }
  }
  if (oldAutos.length + oldLeads.length > 0) {
    console.log(`  (pre-cleanup: removeu ${oldAutos.length} autos e ${oldLeads.length} leads órfãos de runs anteriores)`);
  }
  void toRemoveWn;
}

async function main() {
  console.log("=== Teste CADEIA + JANELA ===\n");
  console.log("DRY_RUN:", process.env.AUTOMATION_DRY_RUN);

  // ── Setup: whatsapp_number + pipeline + stage + conv + lead ──
  const [gh] = await db.select().from(tenant).where(eq(tenant.id, GH)).limit(1);
  if (!gh) {
    console.error("Tenant GH não existe — rode seed");
    process.exit(1);
  }

  await preCleanup();

  // Limpa possíveis whatsapp_numbers de teste anteriores que ficaram órfãos
  const rand = Math.floor(Math.random() * 1_000_000);
  const testPhone = `999${rand.toString().padStart(7, "0")}`;
  const testLabel = `TEST_chain_${rand}`;

  const [wn] = await db
    .insert(whatsappNumber)
    .values({
      tenantId: GH,
      label: testLabel,
      phoneNumber: testPhone,
      uazapiSession: `chain-test-${rand}`,
      uazapiToken: "mock",
      isActive: true,
    })
    .returning({ id: whatsappNumber.id });
  created.wn = wn.id;

  const [pipe] = await db
    .insert(pipeline)
    .values({ tenantId: GH, name: "chain test" })
    .returning({ id: pipeline.id });
  created.pipelines.push(pipe.id);

  const [stage] = await db
    .insert(pipelineStage)
    .values({ tenantId: GH, pipelineId: pipe.id, name: "Novo", order: 0 })
    .returning({ id: pipelineStage.id });
  created.stages.push(stage.id);

  const leadPhone = `5511${rand.toString().padStart(8, "0")}`;
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
      name: "Fulano",
      phone: leadPhone,
      stageId: stage.id,
      source: "inbound",
      crmConversationId: conv.id,
    })
    .returning({ id: lead.id });
  created.leads.push(lid.id);

  // NOTA: não desativamos mais autos pré-existentes. O filtro dry_run no
  // scheduler já isola nossos autos de teste (criados com dry_run=true) dos
  // do usuário. Mas as autos do usuário PODEM agendar logs pro Davi/Gabriel
  // durante o teste — esses logs ficam em status pending no DB e o ticker de
  // produção os processa normalmente (send real). Tolerável: teste checa
  // por lead próprio (Fulano randomizado), não afeta o usuário.

  // ─────────────────────────────────────────────
  // PARTE 1: Cadeia sequencial + incremental
  // ─────────────────────────────────────────────
  console.log("\n── PARTE 1: Cadeia sequencial + incremental ──");

  // 3 follow-ups: 1min, 3min, 10min (todos do mesmo tenant)
  const A1 = await createFollowUpAutomation({ name: "F-1min", inactiveMinutes: 1 });
  const A3 = await createFollowUpAutomation({ name: "F-3min", inactiveMinutes: 3 });
  const A10 = await createFollowUpAutomation({ name: "F-10min", inactiveMinutes: 10 });
  const chainIds = [A1.id, A3.id, A10.id];

  // Simular: operador mandou mensagem há 5 minutos, lead não respondeu
  const t0 = new Date(Date.now() - 5 * 60_000);
  await setConvTimes(conv.id, { lastOutgoingAt: t0, lastIncomingAt: null });

  // ─── TESTE 1+2: Primeira chamada agenda APENAS o step 1min (step 1) ───
  // Checamos por lead (não total global — outros leads do tenant podem contribuir)
  await resetLeadLogs(lid.id, chainIds);
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs1 = await getLogs(lid.id, chainIds);
  check(
    "[1] Cadeia: primeira chamada agenda APENAS 1 step pro lead",
    logs1.length === 1,
    `logs=${logs1.length}`
  );
  check(
    "[2] Cadeia: log agendado é do A1 (menor threshold)",
    logs1.length === 1 && logs1[0].automationId === A1.id,
    `autoId=${logs1[0]?.automationId}`
  );

  // ─── TESTE 3: Segundo agendamento NÃO dispara A3 antes do A1 estar SENT ───
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs1b = await getLogs(lid.id, chainIds);
  const names1b: Record<string, string> = { [A1.id]: "A1", [A3.id]: "A3", [A10.id]: "A10" };
  const detail1b = logs1b.map((l) => `${names1b[l.automationId]}:${l.status}`).join(",");
  check(
    "[3] Cadeia: A3 NÃO agenda enquanto A1 está pending (pré-req: step anterior sent)",
    logs1b.length === 1,
    `logs=${logs1b.length} [${detail1b}]`
  );

  // ─── TESTE 4: Processa pending → A1 vira sent ───
  await processPendingAutomations(50);
  const [a1Log] = await db
    .select()
    .from(automationLog)
    .where(
      and(eq(automationLog.automationId, A1.id), eq(automationLog.leadId, lid.id))
    );
  check(
    "[4] Runner processa A1 do lead: status=sent",
    a1Log?.status === "sent",
    `status=${a1Log?.status} error=${a1Log?.error}`
  );

  // ─── TESTE 5: Runner NÃO atualizou lastOutgoingAt (loop-proof) ───
  const [c1] = await db
    .select({
      out: crmConversation.lastOutgoingAt,
      msg: crmConversation.lastMessageAt,
    })
    .from(crmConversation)
    .where(eq(crmConversation.id, conv.id))
    .limit(1);
  check(
    "[5] Loop-proof: runner NÃO alterou lastOutgoingAt após send",
    c1.out?.getTime() === t0.getTime(),
    `outAt=${c1.out?.toISOString()} expected=${t0.toISOString()}`
  );
  check(
    "[5.1] Inbox: runner atualizou lastMessageAt",
    !!c1.msg && c1.msg.getTime() > t0.getTime(),
    `msgAt=${c1.msg?.toISOString()}`
  );

  // ─── TESTE 6: A3 ainda NÃO dispara — executedAt de A1 é NOW → 3min não passou ───
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs6 = await getLogs(lid.id, chainIds);
  check(
    "[6] Cadeia incremental: A3 NÃO agenda logo após A1 sent (threshold=3min)",
    logs6.filter((l) => l.automationId === A3.id).length === 0,
    `A3 logs=${logs6.filter((l) => l.automationId === A3.id).length}`
  );

  // ─── TESTE 7: Força executedAt de A1 pra 3 min atrás → A3 vira elegível ───
  const threeMinAgo = new Date(Date.now() - 3 * 60_000);
  await db
    .update(automationLog)
    .set({ executedAt: threeMinAgo })
    .where(and(eq(automationLog.automationId, A1.id), eq(automationLog.leadId, lid.id)));

  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs7 = await getLogs(lid.id, chainIds);
  const a3log = logs7.find((l) => l.automationId === A3.id);
  check(
    "[7] Cadeia incremental: A3 agendado 3min após A1.executedAt",
    !!a3log,
    `A3 log existe? ${!!a3log}`
  );
  check(
    "[7.1] Cadeia: A10 ainda NÃO agendado (A3 pending)",
    !logs7.find((l) => l.automationId === A10.id),
    `A10 logs=${logs7.filter((l) => l.automationId === A10.id).length}`
  );

  // ─── TESTE 8: processa A3 → sent ───
  await processPendingAutomations(50);
  const [a3Log] = await db
    .select()
    .from(automationLog)
    .where(and(eq(automationLog.automationId, A3.id), eq(automationLog.leadId, lid.id)));
  check(
    "[8] A3 processado: status=sent",
    a3Log?.status === "sent",
    `status=${a3Log?.status} error=${a3Log?.error} dryRun=${a3Log?.dryRun}`
  );

  // ─── TESTE 9: Auto-não-repetição — A1 NÃO re-agenda mesmo com lastIncoming=null ───
  await db
    .update(automationLog)
    .set({ executedAt: new Date(Date.now() - 20 * 60_000) })
    .where(and(eq(automationLog.automationId, A3.id), eq(automationLog.leadId, lid.id)));
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logsNow = await getLogs(lid.id, chainIds);
  const a1Count = logsNow.filter((l) => l.automationId === A1.id).length;
  check(
    "[9] Sem auto-repetição: A1 tem EXATAMENTE 1 log no ciclo (não repetiu)",
    a1Count === 1,
    `a1Count=${a1Count}`
  );

  // ─── TESTE 10: A10 agora deve ter log (A3 sent + 20min > 10min threshold) ───
  check(
    "[10] Cadeia completa 3 steps: A10 agendado após A3.executedAt+10min",
    logsNow.some((l) => l.automationId === A10.id),
    `A10 logs=${logsNow.filter((l) => l.automationId === A10.id).length}`
  );

  // ─────────────────────────────────────────────
  // PARTE 2: Reset da cadeia
  // ─────────────────────────────────────────────
  console.log("\n── PARTE 2: Reset da cadeia ──");

  // ─── TESTE 11: Operador manda nova msg (lastOutgoing atualiza) → cadeia reinicia ───
  await resetLeadLogs(lid.id, chainIds);
  // Também limpa TODOS os logs de qualquer auto pro lead (pra ficar virgem)
  await db.delete(automationLog).where(eq(automationLog.leadId, lid.id));
  await setConvTimes(conv.id, {
    lastOutgoingAt: new Date(Date.now() - 2 * 60_000), // 2min atrás
    lastIncomingAt: null,
  });
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs11 = await getLogs(lid.id, chainIds);
  const autoNames: Record<string, string> = { [A1.id]: "A1", [A3.id]: "A3", [A10.id]: "A10" };
  const logsDetail = logs11.map((l) => `${autoNames[l.automationId] ?? l.automationId}:${l.status}`).join(",");
  check(
    "[11] Reset: operador manda nova msg → A1 re-agenda no novo ciclo",
    logs11.length === 1 && logs11[0].automationId === A1.id,
    `logs=${logs11.length} [${logsDetail}]`
  );

  // ─── TESTE 12: Lead respondeu (lastIncoming > lastOutgoing) → bloqueia ───
  await resetLeadLogs(lid.id, chainIds);
  await setConvTimes(conv.id, {
    lastOutgoingAt: new Date(Date.now() - 10 * 60_000),
    lastIncomingAt: new Date(Date.now() - 5 * 60_000), // lead respondeu DEPOIS do operador
  });
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs12 = await getLogs(lid.id, chainIds);
  check(
    "[12] Elegibilidade: lead respondeu depois → cadeia NÃO agenda",
    logs12.length === 0,
    `logs=${logs12.length}`
  );

  // ─────────────────────────────────────────────
  // PARTE 3: Janela de horário
  // ─────────────────────────────────────────────
  console.log("\n── PARTE 3: Janela de horário ──");

  // Remove os 3 autos da parte 1 (pra ter cadeia limpa)
  for (const aid of [A1.id, A3.id, A10.id]) {
    await db.delete(automationLog).where(eq(automationLog.automationId, aid));
    await db.delete(automationStep).where(eq(automationStep.automationId, aid));
    await db.delete(automation).where(eq(automation.id, aid));
    created.automations = created.automations.filter((x) => x !== aid);
  }

  // Hora atual no BRT
  const nowBRT = parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }),
    10
  );
  const brtHour = nowBRT === 24 ? 0 : nowBRT;

  // Antes dos testes de janela: desativa os 3 autos da Parte 1 e limpa logs do lead
  for (const aid of chainIds) {
    await db.update(automation).set({ isActive: false }).where(eq(automation.id, aid));
  }
  await db.delete(automationLog).where(eq(automationLog.leadId, lid.id));

  // ─── TESTE 13: Janela que INCLUI a hora atual → dispara ───
  const WinIn = await createFollowUpAutomation({
    name: "F-win-in",
    inactiveMinutes: 1,
    sendWindow: {
      startHour: (brtHour + 23) % 24, // 1 hora antes
      endHour: (brtHour + 1) % 24, // 1 hora depois (exclusivo)
    },
  });
  await setConvTimes(conv.id, {
    lastOutgoingAt: new Date(Date.now() - 2 * 60_000),
    lastIncomingAt: null,
  });
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs13 = await getLogs(lid.id, [WinIn.id]);
  check(
    "[13] Janela de horário: DENTRO da janela → agenda",
    logs13.length === 1,
    `logs=${logs13.length} hora_brt=${brtHour} janela=${(brtHour+23)%24}-${(brtHour+1)%24}`
  );
  // Desativa WinIn antes do próximo teste
  await db.update(automation).set({ isActive: false }).where(eq(automation.id, WinIn.id));
  await db.delete(automationLog).where(eq(automationLog.leadId, lid.id));

  // ─── TESTE 14: Janela que NÃO inclui a hora atual → não dispara ───
  const WinOut = await createFollowUpAutomation({
    name: "F-win-out",
    inactiveMinutes: 1,
    sendWindow: {
      startHour: (brtHour + 2) % 24, // 2 horas no futuro
      endHour: (brtHour + 4) % 24,
    },
  });
  await setConvTimes(conv.id, {
    lastOutgoingAt: new Date(Date.now() - 2 * 60_000),
    lastIncomingAt: null,
  });
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs14 = await getLogs(lid.id, [WinOut.id]);
  check(
    "[14] Janela de horário: FORA da janela → NÃO agenda",
    logs14.length === 0,
    `logs=${logs14.length} hora_brt=${brtHour} janela=${(brtHour+2)%24}-${(brtHour+4)%24}`
  );
  await db.update(automation).set({ isActive: false }).where(eq(automation.id, WinOut.id));

  // ─── TESTE 15: Janela nula (start===end) → NÃO agenda ───
  const WinNull = await createFollowUpAutomation({
    name: "F-win-null",
    inactiveMinutes: 1,
    sendWindow: { startHour: 23, endHour: 23 },
  });
  await db.delete(automationLog).where(eq(automationLog.leadId, lid.id));
  await setConvTimes(conv.id, {
    lastOutgoingAt: new Date(Date.now() - 2 * 60_000),
    lastIncomingAt: null,
  });
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs15 = await getLogs(lid.id, [WinNull.id]);
  check(
    "[15] Janela nula (start===end) → NÃO agenda",
    logs15.length === 0,
    `logs=${logs15.length}`
  );
  await db.update(automation).set({ isActive: false }).where(eq(automation.id, WinNull.id));

  // ─── TESTE 16: Janela hora atual (potencialmente atravessando meia-noite) ───
  const crossStart = (brtHour + 23) % 24;
  const crossEnd = (brtHour + 1) % 24;
  const WinCrossReal = await createFollowUpAutomation({
    name: "F-win-cross-real",
    inactiveMinutes: 1,
    sendWindow: { startHour: crossStart, endHour: crossEnd },
  });
  await db.delete(automationLog).where(eq(automationLog.leadId, lid.id));
  await setConvTimes(conv.id, {
    lastOutgoingAt: new Date(Date.now() - 2 * 60_000),
    lastIncomingAt: null,
  });
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs16 = await getLogs(lid.id, [WinCrossReal.id]);
  check(
    "[16] Janela hora atual (atravessando ou não meia-noite) → agenda",
    logs16.length === 1,
    `logs=${logs16.length} janela=${crossStart}-${crossEnd} hora=${brtHour}`
  );
  await db.update(automation).set({ isActive: false }).where(eq(automation.id, WinCrossReal.id));

  // ─────────────────────────────────────────────
  // PARTE 4: Failed bloqueia chain
  // ─────────────────────────────────────────────
  console.log("\n── PARTE 4: Step failed bloqueia cadeia ──");

  // Cria 2 autos em cadeia
  const Bx = await createFollowUpAutomation({ name: "Bx-1min", inactiveMinutes: 1 });
  const By = await createFollowUpAutomation({ name: "By-2min", inactiveMinutes: 2 });
  const bChainIds = [Bx.id, By.id];

  await db.delete(automationLog).where(eq(automationLog.leadId, lid.id));
  await setConvTimes(conv.id, {
    lastOutgoingAt: new Date(Date.now() - 3 * 60_000),
    lastIncomingAt: null,
  });

  // Agenda Bx → processa → mas FORÇA status=failed
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  await db
    .update(automationLog)
    .set({
      status: "failed",
      error: "teste",
      executedAt: new Date(Date.now() - 5 * 60_000), // 5min atrás pra threshold By passar
    })
    .where(and(eq(automationLog.automationId, Bx.id), eq(automationLog.leadId, lid.id)));

  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs17 = await getLogs(lid.id, bChainIds);
  const byLogs17 = logs17.filter((l) => l.automationId === By.id);
  const detail17 = logs17
    .map((l) => `${l.automationId === Bx.id ? "Bx" : l.automationId === By.id ? "By" : "?"}:${l.status}@${l.createdAt?.toISOString?.().slice(11, 19)}`)
    .join(",");
  check(
    "[17] Step anterior failed → By NÃO agenda (cadeia bloqueada)",
    byLogs17.length === 0,
    `By logs=${byLogs17.length} all=[${detail17}]`
  );

  // ─── TESTE 18: marca Bx como sent → By destrava ───
  // Importante: setar executedAt também — chain logic exige sent + executedAt
  // pra usar como anchor. (Em prod, runner sempre seta os dois juntos; aqui
  // simulamos manualmente, então precisa ser explícito.)
  await db
    .update(automationLog)
    .set({ status: "sent", error: null, executedAt: new Date(Date.now() - 3 * 60_000) })
    .where(and(eq(automationLog.automationId, Bx.id), eq(automationLog.leadId, lid.id)));
  await scheduleInactiveLeadFollowups({ tenantId: GH });
  const logs18 = await getLogs(lid.id, bChainIds);
  const byLogs18 = logs18.filter((l) => l.automationId === By.id);
  check(
    "[18] Step anterior virou sent → By agenda",
    byLogs18.length === 1,
    `By logs=${byLogs18.length}`
  );

  // ─── Final ───
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
