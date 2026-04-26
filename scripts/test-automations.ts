/**
 * Teste end-to-end das automações.
 *
 * Roda contra o banco Supabase real mas com AUTOMATION_DRY_RUN=true,
 * ou seja, sem chamar Evolution/Uazapi. Valida TODO o fluxo:
 *   1. Welcome dispara em lead novo
 *   2. Welcome grava crm_message e atualiza last_outgoing_at
 *   3. Follow-up dispara quando lead fica inativo
 *   4. Follow-up é dedupado (não dispara 2x)
 *   5. NADA dispara em grupos
 *
 * Sempre limpa os dados criados ao final.
 *
 * Usage:
 *   npx tsx scripts/test-automations.ts
 */

// Força DRY_RUN antes de importar runner (pra o módulo ler a env correta)
process.env.AUTOMATION_DRY_RUN = "true";

import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { tenant } from "../src/lib/db/schema/tenants";
import {
  whatsappNumber,
  crmConversation,
  crmMessage,
} from "../src/lib/db/schema/crm";
import {
  automation,
  automationStep,
  automationLog,
} from "../src/lib/db/schema/automations";
import { pipeline, pipelineStage, lead } from "../src/lib/db/schema/pipeline";

import {
  triggerFirstMessage,
  scheduleInactiveLeadFollowups,
  processPendingAutomations,
  resolveAudience,
  triggerBroadcast,
  runScheduledAutomations,
} from "../src/lib/automations/runner";
import { leadTag, leadTagAssignment } from "../src/lib/db/schema/pipeline";

// ─────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────

const GH_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_PHONE = "5511999999777";
const TEST_GROUP_PHONE = "5511999999888";

const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
});
const db = drizzle(sql);

// IDs criados, pra cleanup no final
const created = {
  automations: [] as string[],
  pipeline: null as string | null,
  stages: [] as string[],
  leads: [] as string[],
  conversations: [] as string[],
  whatsappNumber: null as string | null,
  tags: [] as string[],
};

let passedChecks = 0;
let failedChecks = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passedChecks++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failedChecks++;
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
    for (const leadId of created.leads) {
      await db.delete(leadTagAssignment).where(eq(leadTagAssignment.leadId, leadId));
    }
    for (const convId of created.conversations) {
      await db.delete(crmMessage).where(eq(crmMessage.conversationId, convId));
    }
    for (const leadId of created.leads) {
      await db.delete(lead).where(eq(lead.id, leadId));
    }
    for (const convId of created.conversations) {
      await db.delete(crmConversation).where(eq(crmConversation.id, convId));
    }
    for (const tagId of created.tags) {
      await db.delete(leadTag).where(eq(leadTag.id, tagId));
    }
    for (const stageId of created.stages) {
      await db.delete(pipelineStage).where(eq(pipelineStage.id, stageId));
    }
    if (created.pipeline) {
      await db.delete(pipeline).where(eq(pipeline.id, created.pipeline));
    }
    if (created.whatsappNumber) {
      await db.delete(whatsappNumber).where(eq(whatsappNumber.id, created.whatsappNumber));
    }
    console.log("  ✓ Cleanup completo");
  } catch (e) {
    console.error("  ✗ Erro no cleanup:", e);
  }
}

// ─────────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────────

async function main() {
  console.log("=== Teste E2E de Automações ===\n");
  console.log("AUTOMATION_DRY_RUN:", process.env.AUTOMATION_DRY_RUN);
  console.log("DATABASE_URL:", process.env.DATABASE_URL?.match(/@([^:]+)/)?.[1]);
  console.log("");

  // ─── 1. Verifica tenant GH ───────────────────────
  const [gh] = await db.select().from(tenant).where(eq(tenant.id, GH_TENANT_ID)).limit(1);
  check("Tenant GH existe (seed rodou)", !!gh);
  if (!gh) {
    console.log("\n❌ ABORTED — rode scripts/seed-initial.ts primeiro");
    process.exit(1);
  }

  // ─── 2. Cria whatsapp_number mock ativo ──────────
  const [wnum] = await db
    .insert(whatsappNumber)
    .values({
      tenantId: GH_TENANT_ID,
      label: "TEST_automations",
      phoneNumber: "0000000000",
      uazapiSession: "test-automations-instance",
      uazapiToken: "mock-token",
      isActive: true,
    })
    .returning({ id: whatsappNumber.id });
  created.whatsappNumber = wnum.id;
  check("whatsapp_number mock criado (active=true)", !!wnum.id);

  // ─── 3. Cria pipeline + primeiro stage (pra lead ter stageId válido) ──
  const [pipe] = await db
    .insert(pipeline)
    .values({
      tenantId: GH_TENANT_ID,
      name: "Test pipeline",
      isDefault: false,
    })
    .returning({ id: pipeline.id });
  created.pipeline = pipe.id;

  const [stage] = await db
    .insert(pipelineStage)
    .values({
      tenantId: GH_TENANT_ID,
      pipelineId: pipe.id,
      name: "Novo",
      order: 0,
    })
    .returning({ id: pipelineStage.id });
  created.stages.push(stage.id);
  check("Pipeline + stage criados", !!stage.id);

  // ─── 4. Cria automations (welcome + follow-up) ───────
  const [welcomeAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST welcome",
      triggerType: "first_message",
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(welcomeAuto.id);

  await db.insert(automationStep).values({
    automationId: welcomeAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Olá {{nome}}, bem vindo!", delayMinutes: 0 },
  });

  const [followUpAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST follow-up",
      triggerType: "lead_inactive",
      triggerConfig: { inactiveDays: 2 },
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(followUpAuto.id);

  await db.insert(automationStep).values({
    automationId: followUpAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Oi {{nome}}, você sumiu" },
  });
  check("2 automations criadas (welcome + follow-up)", created.automations.length === 2);

  // ─── 5. Cria conversation + lead (NÃO grupo) ───────
  const now = new Date();
  const [conv] = await db
    .insert(crmConversation)
    .values({
      tenantId: GH_TENANT_ID,
      whatsappNumberId: wnum.id,
      contactPhone: TEST_PHONE,
      contactJid: `${TEST_PHONE}@s.whatsapp.net`,
      isGroup: false,
      lastMessageAt: now,
      lastIncomingAt: now,
    })
    .returning({ id: crmConversation.id });
  created.conversations.push(conv.id);

  const [testLead] = await db
    .insert(lead)
    .values({
      tenantId: GH_TENANT_ID,
      name: "João Teste",
      phone: TEST_PHONE,
      stageId: stage.id,
      source: "inbound",
      crmConversationId: conv.id,
    })
    .returning({ id: lead.id });
  created.leads.push(testLead.id);
  check("Lead + conversation (não-grupo) criados", !!testLead.id);

  // ─── 6. triggerFirstMessage dispara welcome ───────
  const r1 = await triggerFirstMessage({ tenantId: GH_TENANT_ID, leadId: testLead.id });
  check("triggerFirstMessage agendou 1 step", r1.scheduled === 1, `scheduled=${r1.scheduled}`);

  // ─── 7. processPendingAutomations envia welcome (DRY_RUN) ───
  const p1 = await processPendingAutomations(10);
  check("processPending enviou 1 welcome", p1.sent === 1 && p1.failed === 0, `sent=${p1.sent} failed=${p1.failed} skipped=${p1.skipped}`);

  if (p1.failed > 0) {
    const failedLogs = await db
      .select({ status: automationLog.status, error: automationLog.error })
      .from(automationLog)
      .where(eq(automationLog.automationId, welcomeAuto.id));
    console.log("    Debug:", failedLogs);
  }

  // ─── 8. crm_message outgoing gravado ───
  const outgoingMsgs = await db
    .select()
    .from(crmMessage)
    .where(and(eq(crmMessage.conversationId, conv.id), eq(crmMessage.direction, "outgoing")));
  check(
    "crm_message outgoing gravado pelo runner",
    outgoingMsgs.length === 1 && outgoingMsgs[0].content?.includes("João Teste") === true,
    `found ${outgoingMsgs.length} outgoing`
  );

  // ─── 9. Welcome atualiza last_message_at E last_outgoing_at (conta como "eu respondi") ───
  const [convAfter] = await db
    .select({
      msgAt: crmConversation.lastMessageAt,
      outAt: crmConversation.lastOutgoingAt,
    })
    .from(crmConversation)
    .where(eq(crmConversation.id, conv.id))
    .limit(1);
  check(
    "last_message_at atualizado pelo welcome (inbox ordena certo)",
    !!convAfter?.msgAt && convAfter.msgAt.getTime() >= now.getTime() - 1000,
    `msgAt=${convAfter?.msgAt?.toISOString()}`
  );
  check(
    "last_outgoing_at atualizado pelo welcome (inicia ciclo de follow-up)",
    !!convAfter?.outAt && convAfter.outAt.getTime() >= now.getTime() - 1000,
    `outAt=${convAfter?.outAt?.toISOString() ?? "null"}`
  );

  // ─── 10. Força last_outgoing_at pra 3 dias atrás pra simular inatividade ───
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await db
    .update(crmConversation)
    .set({ lastOutgoingAt: threeDaysAgo, lastIncomingAt: null })
    .where(eq(crmConversation.id, conv.id));

  // ─── 11. scheduleInactiveLeadFollowups encontra o lead ───
  const r2 = await scheduleInactiveLeadFollowups({ tenantId: GH_TENANT_ID });
  check("scheduleInactive agendou 1 follow-up", r2.scheduled === 1, `scheduled=${r2.scheduled}`);

  // ─── 12. Dedup: rodar de novo NÃO deve agendar mais ───
  const r2b = await scheduleInactiveLeadFollowups({ tenantId: GH_TENANT_ID });
  check("Dedup: segunda chamada não re-agenda", r2b.scheduled === 0, `scheduled=${r2b.scheduled}`);

  // ─── 13. processPending envia follow-up ───
  const p2 = await processPendingAutomations(10);
  check("processPending enviou 1 follow-up", p2.sent === 1 && p2.failed === 0, `sent=${p2.sent} failed=${p2.failed}`);

  // ─── 14. Total crm_message outgoing = 2 (welcome + follow-up) ───
  const outgoingAfter = await db
    .select()
    .from(crmMessage)
    .where(and(eq(crmMessage.conversationId, conv.id), eq(crmMessage.direction, "outgoing")));
  check(
    "2 crm_message outgoing gravadas (welcome + follow-up)",
    outgoingAfter.length === 2,
    `found ${outgoingAfter.length}`
  );

  // ─── 15. TESTE DE GRUPO: automation NÃO deve disparar ───
  const [groupConv] = await db
    .insert(crmConversation)
    .values({
      tenantId: GH_TENANT_ID,
      whatsappNumberId: wnum.id,
      contactPhone: TEST_GROUP_PHONE,
      contactJid: `${TEST_GROUP_PHONE}@g.us`,
      isGroup: true,
      lastMessageAt: new Date(),
    })
    .returning({ id: crmConversation.id });
  created.conversations.push(groupConv.id);

  const [groupLead] = await db
    .insert(lead)
    .values({
      tenantId: GH_TENANT_ID,
      name: "Grupo X",
      phone: TEST_GROUP_PHONE,
      stageId: stage.id,
      source: "inbound",
      crmConversationId: groupConv.id,
    })
    .returning({ id: lead.id });
  created.leads.push(groupLead.id);

  const r3 = await triggerFirstMessage({ tenantId: GH_TENANT_ID, leadId: groupLead.id });
  check(
    "Grupo: triggerFirstMessage NÃO agendou nada",
    r3.scheduled === 0,
    `scheduled=${r3.scheduled}`
  );

  // ─── 16. Também não agenda follow-up pra grupo ───
  // Força last_outgoing_at do grupo pra 3 dias atrás
  await db
    .update(crmConversation)
    .set({ lastOutgoingAt: threeDaysAgo, lastIncomingAt: null, isGroup: true })
    .where(eq(crmConversation.id, groupConv.id));

  const r4 = await scheduleInactiveLeadFollowups({ tenantId: GH_TENANT_ID });
  check(
    "Grupo: scheduleInactive NÃO agenda follow-up pra grupo",
    r4.scheduled === 0,
    `scheduled=${r4.scheduled}`
  );

  // ─────────────────────────────────────────────
  //   NOVOS TESTES: filtros + broadcast + scheduled
  // ─────────────────────────────────────────────

  // ─── 17. resolveAudience sem filtro retorna todos (exceto grupo) ───
  const allLeads = await resolveAudience(GH_TENANT_ID, null);
  check(
    "resolveAudience sem filtro retorna 1 lead (exclui grupo)",
    allLeads.length === 1 && allLeads[0] === testLead.id,
    `found=${allLeads.length}`
  );

  // ─── 18. resolveAudience com filtro de stage funciona ───
  const byStage = await resolveAudience(GH_TENANT_ID, { stageIds: [stage.id] });
  check(
    "resolveAudience por stageId retorna 1 lead",
    byStage.length === 1,
    `found=${byStage.length}`
  );

  const byFakeStage = await resolveAudience(GH_TENANT_ID, {
    stageIds: ["00000000-0000-0000-0000-999999999999"],
  });
  check(
    "resolveAudience por stage inexistente retorna 0",
    byFakeStage.length === 0,
    `found=${byFakeStage.length}`
  );

  // ─── 19. resolveAudience com filtro por tag ───
  const [tag] = await db
    .insert(leadTag)
    .values({ tenantId: GH_TENANT_ID, name: "TEST_VIP", color: "#f59e0b" })
    .returning({ id: leadTag.id });
  created.tags.push(tag.id);

  await db.insert(leadTagAssignment).values({ leadId: testLead.id, tagId: tag.id });

  const byTag = await resolveAudience(GH_TENANT_ID, { tagIds: [tag.id] });
  check(
    "resolveAudience por tag retorna lead taggeado",
    byTag.length === 1 && byTag[0] === testLead.id,
    `found=${byTag.length}`
  );

  // ─── 20. BROADCAST manual dispara pra todos os leads (exclui grupo) ───
  const [bcastAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST broadcast",
      triggerType: "manual_broadcast",
      audienceFilter: null, // todos
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(bcastAuto.id);

  await db.insert(automationStep).values({
    automationId: bcastAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Promo: {{nome}}, tá disponível" },
  });

  const bcastResult = await triggerBroadcast({ automationId: bcastAuto.id });
  check(
    "triggerBroadcast mirou 1 lead (exclui grupo)",
    bcastResult.targeted === 1 && bcastResult.scheduled === 1,
    `targeted=${bcastResult.targeted} scheduled=${bcastResult.scheduled}`
  );

  const pBcast = await processPendingAutomations(10);
  check("processPending enviou 1 broadcast", pBcast.sent === 1 && pBcast.failed === 0, `sent=${pBcast.sent} failed=${pBcast.failed}`);

  // ─── 21. Broadcast com filtro de tag (só leads com tag VIP) ───
  const [bcastTagAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST broadcast tag",
      triggerType: "manual_broadcast",
      audienceFilter: { tagIds: [tag.id] },
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(bcastTagAuto.id);

  await db.insert(automationStep).values({
    automationId: bcastTagAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Só pra VIP" },
  });

  const bcastTagResult = await triggerBroadcast({ automationId: bcastTagAuto.id });
  check(
    "Broadcast com filtro por tag mira só leads taggeados",
    bcastTagResult.targeted === 1,
    `targeted=${bcastTagResult.targeted}`
  );

  // ─── 22. scheduled_once com runAt NO PASSADO dispara ───
  const pastDate = new Date(Date.now() - 60_000).toISOString();
  const [onceAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST scheduled once",
      triggerType: "scheduled_once",
      triggerConfig: { runAt: pastDate },
      audienceFilter: null,
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(onceAuto.id);

  await db.insert(automationStep).values({
    automationId: onceAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Agendado" },
  });

  const sched1 = await runScheduledAutomations({ tenantId: GH_TENANT_ID });
  check(
    "scheduled_once: runAt no passado dispara 1x",
    sched1.fired === 1 && sched1.totalScheduled === 1,
    `fired=${sched1.fired} totalScheduled=${sched1.totalScheduled}`
  );

  // ─── 23. Dedup: scheduled_once NÃO dispara 2x ───
  const sched2 = await runScheduledAutomations({ tenantId: GH_TENANT_ID });
  check(
    "scheduled_once: segunda chamada NÃO re-dispara",
    sched2.fired === 0,
    `fired=${sched2.fired}`
  );

  // ─── 24. scheduled_once com runAt NO FUTURO não dispara ───
  const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
  const [futureAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST scheduled future",
      triggerType: "scheduled_once",
      triggerConfig: { runAt: futureDate },
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(futureAuto.id);

  await db.insert(automationStep).values({
    automationId: futureAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Futuro" },
  });

  const sched3 = await runScheduledAutomations({ tenantId: GH_TENANT_ID });
  check("scheduled_once: runAt no futuro NÃO dispara", sched3.fired === 0, `fired=${sched3.fired}`);

  // ─── 25. scheduled_recurring que casa com hora atual dispara ───
  const nowH = new Date().getUTCHours();
  const nowM = new Date().getUTCMinutes();
  const [recurAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST scheduled recurring",
      triggerType: "scheduled_recurring",
      triggerConfig: {
        frequency: "daily",
        hour: nowH,
        minute: Math.max(0, nowM - 1), // garante que minuto passou
      },
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(recurAuto.id);

  await db.insert(automationStep).values({
    automationId: recurAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Recorrente diário" },
  });

  const sched4 = await runScheduledAutomations({ tenantId: GH_TENANT_ID });
  check(
    "scheduled_recurring (daily) dispara no slot atual",
    sched4.fired === 1,
    `fired=${sched4.fired}`
  );

  // ─── 26. Dedup recurring: dentro das 23h, não re-dispara ───
  const sched5 = await runScheduledAutomations({ tenantId: GH_TENANT_ID });
  check(
    "scheduled_recurring: dedup de 23h funciona",
    sched5.fired === 0,
    `fired=${sched5.fired}`
  );

  // ─── 27. scheduled_recurring com hora DIFERENTE não dispara ───
  const [recurOffAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST recurring off-slot",
      triggerType: "scheduled_recurring",
      triggerConfig: {
        frequency: "daily",
        hour: (nowH + 5) % 24,
        minute: 0,
      },
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(recurOffAuto.id);

  await db.insert(automationStep).values({
    automationId: recurOffAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "Outra hora" },
  });

  const sched6 = await runScheduledAutomations({ tenantId: GH_TENANT_ID });
  check(
    "scheduled_recurring fora do slot NÃO dispara",
    sched6.fired === 0,
    `fired=${sched6.fired}`
  );

  // ─── 28. Broadcast NÃO inclui conversa de grupo no audiência ───
  const [groupBcastAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH_TENANT_ID,
      name: "TEST grp guard",
      triggerType: "manual_broadcast",
      audienceFilter: null,
      isActive: true,
    })
    .returning({ id: automation.id });
  created.automations.push(groupBcastAuto.id);

  await db.insert(automationStep).values({
    automationId: groupBcastAuto.id,
    order: 0,
    type: "send_whatsapp",
    config: { message: "X" },
  });

  const gbr = await triggerBroadcast({ automationId: groupBcastAuto.id });
  // Temos 2 leads no tenant: testLead (não grupo) + groupLead (grupo)
  // Broadcast deve pegar só testLead = 1
  check(
    "Broadcast exclui leads de grupos (audiência)",
    gbr.targeted === 1,
    `targeted=${gbr.targeted}`
  );

  // ─── Final ───
  console.log(`\n${failedChecks === 0 ? "✅" : "❌"} ${passedChecks} passou / ${failedChecks} falhou`);

  await cleanup();
  await sql.end();

  process.exit(failedChecks === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n❌ FATAL:", e);
  await cleanup().catch(() => {});
  await sql.end().catch(() => {});
  process.exit(1);
});
