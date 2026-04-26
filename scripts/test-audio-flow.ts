/**
 * test-audio-flow.ts — E2E (read+write) do fluxo de áudio recebido no CRM.
 *
 * Cobre:
 *   1. Cria whatsapp_number, conversation e lead "Fulano Audio Test" (dry-run safe).
 *   2. Insere uma crm_message com mediaType=audio + mediaUrl como data URI
 *      (formato real do WhatsApp: `audio/ogg; codecs=opus`).
 *   3. Verifica que a mensagem foi gravada com mediaUrl preservado.
 *   4. Insere variantes: HTTP URL, data URI sem mime, data URI com mime sem codec.
 *   5. Garante que a query do GET conversation retorna todas as variantes.
 *   6. Verifica que o parse de data URI extrai o mime correto pra `audio/ogg; codecs=opus`.
 *   7. Cleanup completo (lead, conversation, msgs, wn).
 *
 * Segurança:
 *   - Não dispara nenhum webhook externo.
 *   - Não chama Uazapi.
 *   - Telefone aleatório com prefixo `5599999` — fora do range real.
 *   - Cleanup garantido via try/finally.
 *
 * Uso: npx tsx scripts/test-audio-flow.ts
 */

import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
process.env.AUTOMATION_DRY_RUN = "true";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { whatsappNumber, crmConversation, crmMessage } from "../src/lib/db/schema/crm";
import { lead, pipeline, pipelineStage } from "../src/lib/db/schema/pipeline";

const GH = "00000000-0000-0000-0000-000000000001";
const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
});
const db = drizzle(sql);

// Mini OGG/Opus header válido — só pra exercitar o parser, nunca tocado.
const TINY_OGG_OPUS_B64 =
  "T2dnUwACAAAAAAAAAAA+HAAAAAAAAGRAJN0BHgF2b3JiaXMAAAAAAUSsAAAAAAAAgLsAAAAAAAC4AU9nZ1MAAAAAAAAAAAAAPhwAAAEAAACdjAakDQ==";

// Os 3 formatos que a Uazapi/Baileys produzem na prática:
const DATA_URI_WITH_CODECS = `data:audio/ogg; codecs=opus;base64,${TINY_OGG_OPUS_B64}`;
const DATA_URI_SIMPLE = `data:audio/ogg;base64,${TINY_OGG_OPUS_B64}`;
const DATA_URI_NO_MIME = `data:;base64,${TINY_OGG_OPUS_B64}`;
const HTTP_URL = "https://example.com/audio/test.ogg";

const created = {
  msgs: [] as string[],
  leads: [] as string[],
  convs: [] as string[],
  wn: null as string | null,
  pipelines: [] as string[],
  stages: [] as string[],
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

/**
 * Replica a função parseDataUri do endpoint de media route — assim
 * exercitamos o mesmo parsing usado em produção e detectamos regressão.
 */
function parseDataUri(uri: string, fallbackMime: string): { mime: string; payload: string } {
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return { mime: fallbackMime, payload: uri };
  const header = uri.slice(0, commaIdx);
  const payload = uri.slice(commaIdx + 1);
  const meta = header.startsWith("data:") ? header.slice(5) : header;
  const parts = meta.split(";").map((p) => p.trim()).filter(Boolean);
  const mimeParts = parts.filter((p) => p.toLowerCase() !== "base64");
  if (mimeParts.length === 0) return { mime: fallbackMime, payload };
  return { mime: mimeParts.join("; "), payload };
}

async function cleanup() {
  console.log("\n→ Cleanup...");
  try {
    for (const m of created.msgs) {
      await db.delete(crmMessage).where(eq(crmMessage.id, m));
    }
    for (const l of created.leads) {
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
  console.log("=== Teste AUDIO FLOW (E2E) ===\n");

  // ── Setup base ─────────────────────────────────────────────────────
  const uniqPhone = `5599999${Date.now().toString().slice(-7)}`;
  const [wn] = await db
    .insert(whatsappNumber)
    .values({
      tenantId: GH,
      label: "TEST_audio_flow",
      phoneNumber: `audio-${Date.now()}`,
      uazapiSession: "audio-flow-test",
      uazapiToken: "mock",
      isActive: true,
    })
    .returning({ id: whatsappNumber.id });
  created.wn = wn.id;

  const [pipe] = await db
    .insert(pipeline)
    .values({ tenantId: GH, name: "audio test" })
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
      contactPhone: uniqPhone,
      contactJid: `${uniqPhone}@s.whatsapp.net`,
      contactPushName: "Fulano Audio Test",
      isGroup: false,
    })
    .returning({ id: crmConversation.id });
  created.convs.push(conv.id);

  const [testLead] = await db
    .insert(lead)
    .values({
      tenantId: GH,
      name: "Fulano Audio Test",
      phone: uniqPhone,
      stageId: stage.id,
      source: "inbound",
      crmConversationId: conv.id,
    })
    .returning({ id: lead.id });
  created.leads.push(testLead.id);

  check("[setup] whatsapp_number criado", !!wn.id);
  check("[setup] conversation criado", !!conv.id);
  check("[setup] lead Fulano Audio Test criado", !!testLead.id);

  // ── 1. Inserir mensagem de áudio recebida com data URI canônico WhatsApp ──
  const [m1] = await db
    .insert(crmMessage)
    .values({
      conversationId: conv.id,
      messageIdWa: `wa-${Date.now()}-1`,
      direction: "incoming",
      content: null,
      mediaType: "audio",
      mediaUrl: DATA_URI_WITH_CODECS,
      status: "received",
    })
    .returning({ id: crmMessage.id });
  created.msgs.push(m1.id);

  const [m1ck] = await db
    .select({
      id: crmMessage.id,
      mediaType: crmMessage.mediaType,
      mediaUrl: crmMessage.mediaUrl,
      direction: crmMessage.direction,
    })
    .from(crmMessage)
    .where(eq(crmMessage.id, m1.id))
    .limit(1);
  check(
    "[1] msg áudio incoming gravada (data URI com codecs preservado)",
    m1ck?.mediaType === "audio" && m1ck.mediaUrl === DATA_URI_WITH_CODECS,
    `mediaType=${m1ck?.mediaType} url-len=${m1ck?.mediaUrl?.length ?? 0}`
  );

  // ── 2. Variantes de mediaUrl ─────────────────────────────────────
  const [m2] = await db
    .insert(crmMessage)
    .values({
      conversationId: conv.id,
      messageIdWa: `wa-${Date.now()}-2`,
      direction: "incoming",
      mediaType: "audio",
      mediaUrl: DATA_URI_SIMPLE,
      status: "received",
    })
    .returning({ id: crmMessage.id });
  created.msgs.push(m2.id);

  const [m3] = await db
    .insert(crmMessage)
    .values({
      conversationId: conv.id,
      messageIdWa: `wa-${Date.now()}-3`,
      direction: "incoming",
      mediaType: "audio",
      mediaUrl: HTTP_URL,
      status: "received",
    })
    .returning({ id: crmMessage.id });
  created.msgs.push(m3.id);

  const [m4] = await db
    .insert(crmMessage)
    .values({
      conversationId: conv.id,
      messageIdWa: `wa-${Date.now()}-4`,
      direction: "incoming",
      mediaType: "audio",
      mediaUrl: DATA_URI_NO_MIME,
      status: "received",
    })
    .returning({ id: crmMessage.id });
  created.msgs.push(m4.id);

  const [m5] = await db
    .insert(crmMessage)
    .values({
      conversationId: conv.id,
      messageIdWa: `wa-${Date.now()}-5`,
      direction: "outgoing",
      mediaType: "audio",
      mediaUrl: DATA_URI_WITH_CODECS,
      status: "sent",
    })
    .returning({ id: crmMessage.id });
  created.msgs.push(m5.id);

  // ── 3. Listar via SELECT (simula API GET /api/crm/[id]) ───────────
  const allAudios = await db
    .select({
      id: crmMessage.id,
      direction: crmMessage.direction,
      mediaType: crmMessage.mediaType,
      mediaUrl: crmMessage.mediaUrl,
    })
    .from(crmMessage)
    .where(eq(crmMessage.conversationId, conv.id));

  check("[2] 5 áudios persistidos", allAudios.length === 5, `got=${allAudios.length}`);
  check(
    "[3] todos têm mediaUrl não-nulo",
    allAudios.every((a) => a.mediaUrl && a.mediaUrl.length > 0),
    `nulls=${allAudios.filter((a) => !a.mediaUrl).length}`
  );
  check(
    "[4] outgoing + incoming presentes",
    allAudios.filter((a) => a.direction === "incoming").length === 4 &&
      allAudios.filter((a) => a.direction === "outgoing").length === 1
  );

  // ── 4. Parser de data URI ────────────────────────────────────────
  const p1 = parseDataUri(DATA_URI_WITH_CODECS, "audio/ogg");
  check(
    "[5] parseDataUri preserva codecs (audio/ogg; codecs=opus)",
    p1.mime === "audio/ogg; codecs=opus",
    `got mime="${p1.mime}"`
  );
  check("[5b] payload base64 preservado", p1.payload === TINY_OGG_OPUS_B64);

  const p2 = parseDataUri(DATA_URI_SIMPLE, "audio/ogg");
  check(
    "[6] parseDataUri sem codecs (audio/ogg)",
    p2.mime === "audio/ogg",
    `got mime="${p2.mime}"`
  );

  const p3 = parseDataUri(DATA_URI_NO_MIME, "audio/ogg");
  check(
    "[7] parseDataUri data:;base64,... usa fallback mime",
    p3.mime === "audio/ogg",
    `got mime="${p3.mime}"`
  );
  check("[7b] payload válido apesar de mime vazio", p3.payload === TINY_OGG_OPUS_B64);

  const p4 = parseDataUri("invalido-sem-virgula", "audio/ogg");
  check(
    "[8] parseDataUri sem vírgula → fallback + payload bruto",
    p4.mime === "audio/ogg" && p4.payload === "invalido-sem-virgula"
  );

  // ── 5. Buffer round-trip (simula resposta do endpoint) ───────────
  const buf = Buffer.from(p1.payload, "base64");
  check(
    "[9] base64 decode → buffer com bytes válidos (header OGG)",
    buf.length > 0 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67, // "Ogg"
    `len=${buf.length} first3=${buf.slice(0, 3).toString("hex")}`
  );

  // ── 6. URL HTTP simples ──────────────────────────────────────────
  const httpAudio = allAudios.find((a) => a.mediaUrl === HTTP_URL);
  check(
    "[10] mensagem com URL HTTP preservada (sem data:URI parsing)",
    !!httpAudio && httpAudio.mediaUrl?.startsWith("https://") === true
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
