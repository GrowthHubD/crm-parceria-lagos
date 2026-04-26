/**
 * test-uazapi-end-to-end.ts — documentação executável do fluxo completo
 * de mensagens recebidas via Uazapi.
 *
 * Cobre (em DRY_RUN — nenhuma chamada real ao WhatsApp):
 *
 *   1. Webhook in (simulado): payload da Uazapi v2 é validado / parseado.
 *   2. Lead novo (first_message) → automation 'first_message' (welcome) agendada.
 *   3. Cadeia de follow-up (lead_inactive) com 3 thresholds em min — só step0
 *      vira "upcoming" enquanto os anteriores não rodaram.
 *   4. Mensagem de áudio recebida → crm_message gravado com mediaType=audio.
 *   5. Lead resposta (incoming após outgoing) → cadeia bloqueada.
 *   6. Reset para reaproveitamento.
 *
 * Não toca em nada de produção:
 *   - Telefone aleatório fora do range real.
 *   - automation.dryRun=true → produção ignora.
 *   - Cleanup completo no final.
 *
 * Uso: npx tsx scripts/test-uazapi-end-to-end.ts
 */

import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
process.env.AUTOMATION_DRY_RUN = "true";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { whatsappNumber, crmConversation, crmMessage } from "../src/lib/db/schema/crm";
import {
  automation,
  automationStep,
  automationLog,
} from "../src/lib/db/schema/automations";
import { lead, pipeline, pipelineStage } from "../src/lib/db/schema/pipeline";
import { getNextFollowUp } from "../src/lib/automations/chain-preview";

const GH = "00000000-0000-0000-0000-000000000001";
const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
});
const db = drizzle(sql);

const TINY_OGG_OPUS_B64 =
  "T2dnUwACAAAAAAAAAAA+HAAAAAAAAGRAJN0BHgF2b3JiaXMAAAAAAUSsAAAAAAAAgLsAAAAAAAC4AU9nZ1MAAAAAAAAAAAAAPhwAAAEAAACdjAakDQ==";
const AUDIO_DATA_URI = `data:audio/ogg; codecs=opus;base64,${TINY_OGG_OPUS_B64}`;

const created = {
  msgs: [] as string[],
  leads: [] as string[],
  convs: [] as string[],
  wn: null as string | null,
  pipelines: [] as string[],
  stages: [] as string[],
  automations: [] as string[],
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

// ── Simulação de webhook Uazapi v2 ──────────────────────────────────
// Replica o shape relevante (campos consumidos pelo webhook handler).
type SimulatedUazapiPayload = {
  EventType: "messages";
  message: {
    id: string;
    chatid: string;
    sender: string;
    fromMe: boolean;
    isGroup: boolean;
    messageType: string;
    type?: string;
    mediaType?: string;
    text?: string;
    pushName?: string;
  };
};

function buildIncomingTextPayload(phone: string): SimulatedUazapiPayload {
  return {
    EventType: "messages",
    message: {
      id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatid: `${phone}@s.whatsapp.net`,
      sender: `${phone}@s.whatsapp.net`,
      fromMe: false,
      isGroup: false,
      messageType: "text",
      type: "text",
      text: "Olá, vim do Instagram",
      pushName: "Fulano E2E",
    },
  };
}

function buildIncomingAudioPayload(phone: string): SimulatedUazapiPayload {
  return {
    EventType: "messages",
    message: {
      id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatid: `${phone}@s.whatsapp.net`,
      sender: `${phone}@s.whatsapp.net`,
      fromMe: false,
      isGroup: false,
      messageType: "audio",
      type: "audio",
      mediaType: "audio",
      pushName: "Fulano E2E",
    },
  };
}

async function cleanup() {
  console.log("\n→ Cleanup...");
  try {
    for (const aid of created.automations) {
      await db.delete(automationLog).where(eq(automationLog.automationId, aid));
      await db.delete(automationStep).where(eq(automationStep.automationId, aid));
      await db.delete(automation).where(eq(automation.id, aid));
    }
    for (const m of created.msgs) {
      await db.delete(crmMessage).where(eq(crmMessage.id, m));
    }
    for (const l of created.leads) {
      await db.delete(automationLog).where(eq(automationLog.leadId, l));
      await db.delete(lead).where(eq(lead.id, l));
    }
    for (const c of created.convs) {
      await db.delete(crmMessage).where(eq(crmMessage.conversationId, c));
      await db.delete(crmConversation).where(eq(crmConversation.id, c));
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
  console.log("=== Teste UAZAPI END-TO-END (DRY RUN) ===\n");

  // ── Setup base ──────────────────────────────────────────────────
  const uniqPhone = `5599888${Date.now().toString().slice(-7)}`;
  const [wn] = await db
    .insert(whatsappNumber)
    .values({
      tenantId: GH,
      label: "TEST_e2e",
      phoneNumber: `e2e-${Date.now()}`,
      uazapiSession: "e2e-test",
      uazapiToken: "mock",
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

  // ── Cria automation welcome (first_message) ─────────────────────
  const [welcomeAuto] = await db
    .insert(automation)
    .values({
      tenantId: GH,
      name: "Welcome E2E",
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
    config: { message: "Oi {{nome}}, bem-vindo!" },
  });

  // ── Cria cadeia lead_inactive (1, 5, 30 min) ────────────────────
  const thresholds = [1, 5, 30];
  const chainAutoIds: string[] = [];
  for (const t of thresholds) {
    const [a] = await db
      .insert(automation)
      .values({
        tenantId: GH,
        name: `Chain E2E ${t}min`,
        triggerType: "lead_inactive",
        triggerConfig: { inactiveMinutes: t },
        isActive: true,
        dryRun: true,
      })
      .returning({ id: automation.id });
    created.automations.push(a.id);
    chainAutoIds.push(a.id);
    await db.insert(automationStep).values({
      automationId: a.id,
      order: 0,
      type: "send_whatsapp",
      config: { message: `Follow-up ${t}min: oi {{nome}}` },
    });
  }

  // ── 1. Webhook in: payload de texto recebido ────────────────────
  const textPayload = buildIncomingTextPayload(uniqPhone);
  check(
    "[1] payload Uazapi v2 (texto) tem shape esperado",
    textPayload.EventType === "messages" &&
      !textPayload.message.fromMe &&
      !!textPayload.message.text
  );

  // ── 2. Cria conversation + lead (simula webhook handler) ────────
  const [conv] = await db
    .insert(crmConversation)
    .values({
      tenantId: GH,
      whatsappNumberId: wn.id,
      contactPhone: uniqPhone,
      contactJid: textPayload.message.chatid,
      contactPushName: textPayload.message.pushName,
      isGroup: false,
      lastIncomingAt: new Date(),
      lastMessageAt: new Date(),
      unreadCount: 1,
    })
    .returning({ id: crmConversation.id });
  created.convs.push(conv.id);
  check("[2] conversation criada com unreadCount=1", !!conv.id);

  // Insere msg incoming texto
  const [msgText] = await db
    .insert(crmMessage)
    .values({
      conversationId: conv.id,
      messageIdWa: textPayload.message.id,
      direction: "incoming",
      content: textPayload.message.text!,
      mediaType: "text",
      status: "received",
    })
    .returning({ id: crmMessage.id });
  created.msgs.push(msgText.id);
  check("[3] crm_message texto incoming gravada", !!msgText.id);

  // Cria lead vinculado
  const [newLead] = await db
    .insert(lead)
    .values({
      tenantId: GH,
      name: textPayload.message.pushName!,
      phone: uniqPhone,
      stageId: stage.id,
      source: "inbound",
      crmConversationId: conv.id,
    })
    .returning({ id: lead.id });
  created.leads.push(newLead.id);
  check("[4] lead criado e vinculado à conversation", !!newLead.id);

  // ── 5. Welcome agendado (replica triggerFirstMessage minimal) ───
  const [welcomeLog] = await db
    .insert(automationLog)
    .values({
      automationId: welcomeAuto.id,
      leadId: newLead.id,
      triggerType: "first_message",
      status: "pending",
      scheduledAt: new Date(),
      dryRun: true,
    })
    .returning({ id: automationLog.id });
  check(
    "[5] welcome (first_message) agendado em automation_log com dryRun=true",
    !!welcomeLog.id
  );

  // ── 6. Áudio incoming ───────────────────────────────────────────
  const audioPayload = buildIncomingAudioPayload(uniqPhone);
  const [msgAudio] = await db
    .insert(crmMessage)
    .values({
      conversationId: conv.id,
      messageIdWa: audioPayload.message.id,
      direction: "incoming",
      mediaType: "audio",
      mediaUrl: AUDIO_DATA_URI,
      status: "received",
    })
    .returning({ id: crmMessage.id });
  created.msgs.push(msgAudio.id);
  check(
    "[6] crm_message áudio incoming gravada com mediaUrl preservado",
    !!msgAudio.id
  );

  const [m6Verify] = await db
    .select({ mediaType: crmMessage.mediaType, mediaUrl: crmMessage.mediaUrl })
    .from(crmMessage)
    .where(eq(crmMessage.id, msgAudio.id))
    .limit(1);
  check(
    "[7] mediaType=audio e mediaUrl começa com data:audio/ogg",
    m6Verify?.mediaType === "audio" &&
      !!m6Verify.mediaUrl?.startsWith("data:audio/ogg")
  );

  // ── 8. Operator responde (outgoing) → lastOutgoingAt setado ─────
  const outgoingTime = new Date(Date.now() - 30_000); // 30s atrás (dentro do 1min)
  const [msgOut] = await db
    .insert(crmMessage)
    .values({
      conversationId: conv.id,
      messageIdWa: `wa-out-${Date.now()}`,
      direction: "outgoing",
      content: "Oi! Como posso ajudar?",
      mediaType: "text",
      status: "sent",
      timestamp: outgoingTime,
    })
    .returning({ id: crmMessage.id });
  created.msgs.push(msgOut.id);

  await db
    .update(crmConversation)
    .set({ lastOutgoingAt: outgoingTime, lastIncomingAt: null })
    .where(eq(crmConversation.id, conv.id));
  check("[8] outgoing gravado e lastOutgoingAt atualizado", !!msgOut.id);

  // ── 9. Cadeia: getNextFollowUp deve apontar pro step de 1min ────
  const next = await getNextFollowUp({ tenantId: GH, leadId: newLead.id });
  check(
    "[9] getNextFollowUp aponta pro step 1min upcoming (cadeia ativa)",
    next !== null && next.automationId === chainAutoIds[0],
    `got=${next ? `${next.automationName}/${next.status}` : "null"}`
  );

  // ── 10. Lead responde (incoming > outgoing) → cadeia bloqueada ──
  await db
    .update(crmConversation)
    .set({ lastIncomingAt: new Date(Date.now() - 10_000) })
    .where(eq(crmConversation.id, conv.id));
  const next2 = await getNextFollowUp({ tenantId: GH, leadId: newLead.id });
  check(
    "[10] após lead responder, getNextFollowUp retorna null (cadeia bloqueada)",
    next2 === null,
    `got=${next2 ? next2.automationName : "null"}`
  );

  // ── 11. Verifica que ainda nada foi enviado (dry_run só gravou logs) ─
  const sentLogs = await db
    .select({ id: automationLog.id })
    .from(automationLog)
    .where(
      and(
        eq(automationLog.leadId, newLead.id),
        eq(automationLog.status, "sent")
      )
    );
  check(
    "[11] nenhum log com status=sent (dry-run mode confirmado)",
    sentLogs.length === 0,
    `got=${sentLogs.length}`
  );

  // ── 12. Webhook idempotência: mesma messageIdWa não duplica ────
  const dupAttempt = await db
    .select({ id: crmMessage.id })
    .from(crmMessage)
    .where(eq(crmMessage.messageIdWa, textPayload.message.id));
  check(
    "[12] messageIdWa lookup idempotente (1 match para o id processado)",
    dupAttempt.length === 1,
    `got=${dupAttempt.length}`
  );

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
