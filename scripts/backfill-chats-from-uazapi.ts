/**
 * Backfill de CONVERSAS (contatos) a partir do WhatsApp via Uazapi.
 *
 * O webhook só cria conversa quando chega mensagem nova — contatos que existem
 * no WhatsApp mas não tiveram atividade desde a conexão nunca entram no banco.
 * Este script descobre os chats reais da instância (POST /chat/find), faz upsert
 * em crm_conversation (dedup pela unique (whatsapp_number_id, contact_phone)) e
 * puxa as últimas N mensagens por chat (POST /message/find) pra crm_message
 * (dedup pela unique (conversation_id, message_id_wa)).
 *
 * NÃO cria leads nem dispara automações de welcome (escreve direto no banco,
 * fora do runner) — evita poluir o funil e mandar welcome em massa.
 *
 * Idempotente: reexecutar não duplica. Útil pra elevar --chats depois.
 *
 * Uso:
 *   npx tsx scripts/backfill-chats-from-uazapi.ts <slug|tenantId> [<slug2> ...] [--dry] [--chats=200] [--msgs=30]
 *
 * Ex.:  npx tsx scripts/backfill-chats-from-uazapi.ts alexandre marcos --dry
 *       npx tsx scripts/backfill-chats-from-uazapi.ts alexandre marcos
 *
 * --dry: descobre os chats e conta conversas a criar/atualizar, sem escrever
 *        (pula o fetch de mensagens — só valida a descoberta de contatos).
 */
import { config } from "dotenv";
// .env.local vive na pasta-mãe (fora do git root); carrega de lá com fallback local.
config({ path: ".env.local", override: true });
config({ path: "../.env.local", override: true });
import postgres from "postgres";

// ── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const CHATS_LIMIT = Number(
  (args.find((a) => a.startsWith("--chats=")) ?? "--chats=200").split("=")[1]
) || 200;
const MSGS_LIMIT = Number(
  (args.find((a) => a.startsWith("--msgs=")) ?? "--msgs=30").split("=")[1]
) || 30;
const TENANTS = args.filter((a) => !a.startsWith("--"));

if (TENANTS.length === 0) {
  console.error(
    "Uso: npx tsx scripts/backfill-chats-from-uazapi.ts <slug|tenantId> [...] [--dry] [--chats=200] [--msgs=30]"
  );
  process.exit(1);
}

const PAGE = 100; // page size do /chat/find
const MAX_PAGES = 50; // teto de segurança (5000 chats varridos por instância)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Tipos Uazapi ──────────────────────────────────────────────────────────
type UChat = {
  wa_chatid?: string;
  wa_isGroup?: boolean;
  wa_contactName?: string;
  wa_name?: string;
  name?: string;
  imagePreview?: string;
  wa_lastMsgTimestamp?: number;
};

type UMsg = {
  messageid?: string;
  id?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  messageTimestamp?: number;
  mediaType?: string;
  type?: string;
  messageType?: string;
  text?: string;
  caption?: string;
  senderName?: string;
  content?: { text?: string; caption?: string };
};

// ── Helpers (espelham webhook v2 + backfill-outgoing) ─────────────────────
function extractPhone(jidOrPhone: string): string {
  return jidOrPhone.replace(/@.*$/, "").replace(/[^0-9]/g, "");
}

function mediaTypeOf(m: UMsg): string {
  const t = (m.mediaType || m.type || "").toLowerCase();
  if (["image", "video", "audio", "document"].includes(t)) return t;
  if (t === "ptt" || t === "voice") return "audio";
  if (t === "sticker") return "image";
  const mt = (m.messageType || "").toLowerCase();
  if (mt.includes("image")) return "image";
  if (mt.includes("video")) return "video";
  if (mt.includes("audio") || mt.includes("ptt")) return "audio";
  if (mt.includes("document")) return "document";
  return "text";
}

function contentOf(m: UMsg): string | null {
  const c = m.content?.text ?? m.text ?? m.caption ?? m.content?.caption ?? null;
  return typeof c === "string" && c.trim() ? c : null;
}

/** Uazapi manda timestamp em ms (13 dígitos). Guard pra segundos legados. */
function toDate(v: number | undefined): Date {
  const n = Number(v) || 0;
  if (n <= 0) return new Date();
  return new Date(n < 1e12 ? n * 1000 : n);
}

function nameOf(c: UChat): string | null {
  return c.wa_contactName?.trim() || c.name?.trim() || c.wa_name?.trim() || null;
}

// ── Uazapi calls ──────────────────────────────────────────────────────────
async function chatFind(
  server: string,
  token: string,
  offset: number
): Promise<{ chats: UChat[]; total: number }> {
  const res = await fetch(`${server.replace(/\/$/, "")}/chat/find`, {
    method: "POST",
    headers: { token, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: PAGE, offset, sort: "-wa_lastMsgTimestamp" }),
  });
  if (!res.ok) throw new Error(`/chat/find ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const j = (await res.json()) as { chats?: UChat[]; pagination?: { totalRecords?: number } };
  return { chats: j.chats ?? [], total: j.pagination?.totalRecords ?? 0 };
}

async function messageFind(
  server: string,
  token: string,
  chatid: string,
  limit: number
): Promise<UMsg[]> {
  // Retry: a instância às vezes responde 404 "host not mapped" / 5xx transitório
  // sob rajada — sem retry, um blip esvazia o backfill inteiro (visto no 1º run).
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${server.replace(/\/$/, "")}/message/find`, {
        method: "POST",
        headers: { token, "Content-Type": "application/json" },
        body: JSON.stringify({ chatid, limit, offset: 0, sort: "-messageTimestamp" }),
      });
      if (!res.ok) throw new Error(`/message/find ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const j = (await res.json()) as { messages?: UMsg[] };
      return j.messages ?? [];
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!url) {
    console.error("DATABASE_URL/DIRECT_URL não definido (.env.local).");
    process.exit(1);
  }
  const envBase = process.env.UAZAPI_BASE_URL || "https://api.uazapi.com";
  const sql = postgres(url, { prepare: false, max: 1 });

  console.log(`\n=== BACKFILL CHATS | DRY=${DRY} | --chats=${CHATS_LIMIT} | --msgs=${MSGS_LIMIT} ===`);

  for (const arg of TENANTS) {
    const [t] = await sql<{ id: string; name: string; slug: string }[]>`
      SELECT id, name, slug FROM public.tenant WHERE slug = ${arg} OR id::text = ${arg} LIMIT 1`;
    if (!t) {
      console.warn(`\n[${arg}] tenant não encontrado — pulando.`);
      continue;
    }
    const [wn] = await sql<
      { id: string; tenant_id: string; server_url: string | null; uazapi_token: string; label: string }[]
    >`
      SELECT id, tenant_id, server_url, uazapi_token, label FROM public.whatsapp_number
      WHERE tenant_id = ${t.id} AND is_active = true LIMIT 1`;
    if (!wn) {
      console.warn(`\n[${t.slug}] sem whatsapp_number ativo — pulando.`);
      continue;
    }
    const server = (wn.server_url || envBase).replace(/\/$/, "");
    console.log(`\n── tenant "${t.name}" (${t.slug}) | número "${wn.label}" | server ${server}`);

    // 1. Descobrir chats não-grupo até CHATS_LIMIT
    const collected: UChat[] = [];
    let offset = 0;
    let total = 0;
    for (let p = 0; p < MAX_PAGES && collected.length < CHATS_LIMIT; p++) {
      let page: { chats: UChat[]; total: number };
      try {
        page = await chatFind(server, wn.uazapi_token, offset);
      } catch (e) {
        console.warn(`   erro /chat/find offset=${offset}: ${(e as Error).message}`);
        break;
      }
      total = page.total;
      if (page.chats.length === 0) break;
      for (const c of page.chats) {
        if (c.wa_isGroup === true) continue;
        if (!c.wa_chatid || !extractPhone(c.wa_chatid)) continue;
        collected.push(c);
        if (collected.length >= CHATS_LIMIT) break;
      }
      offset += PAGE;
      if (offset >= total) break;
    }
    console.log(`   ${collected.length} chats 1:1 coletados (de ${total} no total na instância)`);

    let created = 0;
    let updated = 0;
    let msgsInserted = 0;
    let chatsWithMsgs = 0;
    let chatsEmpty = 0;
    let chatsErr = 0;

    for (const c of collected) {
      const phone = extractPhone(c.wa_chatid!);
      const jid = c.wa_chatid!;
      const pushName = nameOf(c);
      const pic =
        c.imagePreview && c.imagePreview.startsWith("http") ? c.imagePreview : null;
      const lastAt = toDate(c.wa_lastMsgTimestamp);

      if (DRY) {
        const [ex] = await sql`
          SELECT 1 FROM public.crm_conversation
          WHERE whatsapp_number_id = ${wn.id} AND contact_phone = ${phone} LIMIT 1`;
        if (ex) updated++;
        else created++;
        continue;
      }

      // 2. Upsert conversa
      const [conv] = await sql<{ id: string; existed: boolean }[]>`
        INSERT INTO public.crm_conversation
          (whatsapp_number_id, tenant_id, contact_phone, contact_jid,
           contact_push_name, contact_profile_pic_url, classification, is_group,
           last_message_at, unread_count)
        VALUES
          (${wn.id}, ${wn.tenant_id}, ${phone}, ${jid},
           ${pushName}, ${pic}, 'new', false, ${lastAt}, 0)
        ON CONFLICT (whatsapp_number_id, contact_phone) DO UPDATE SET
          contact_jid = COALESCE(EXCLUDED.contact_jid, public.crm_conversation.contact_jid),
          contact_push_name = COALESCE(NULLIF(EXCLUDED.contact_push_name, ''), public.crm_conversation.contact_push_name),
          contact_profile_pic_url = COALESCE(EXCLUDED.contact_profile_pic_url, public.crm_conversation.contact_profile_pic_url),
          last_message_at = GREATEST(COALESCE(public.crm_conversation.last_message_at, to_timestamp(0)), EXCLUDED.last_message_at),
          updated_at = now()
        RETURNING id, (xmax <> 0) AS existed`;
      if (conv.existed) updated++;
      else created++;

      // 3. Backfill das últimas MSGS_LIMIT mensagens do chat
      let msgs: UMsg[] = [];
      try {
        msgs = await messageFind(server, wn.uazapi_token, jid, MSGS_LIMIT);
        if (msgs.length > 0) chatsWithMsgs++;
        else chatsEmpty++;
      } catch (e) {
        chatsErr++;
        console.warn(`   [${phone}] erro /message/find: ${(e as Error).message}`);
      }
      await sleep(120); // throttle — gentil com a instância (evita o blip do 1º run)

      let maxTs = 0;
      let maxIn = 0;
      let maxOut = 0;
      for (const m of msgs) {
        if (m.isGroup === true) continue;
        const messageid = m.messageid ?? m.id;
        if (!messageid) continue;
        const isOut = m.fromMe === true;
        const tsNum = Number(m.messageTimestamp) || 0;
        const tsDate = toDate(m.messageTimestamp);
        if (tsNum > maxTs) maxTs = tsNum;
        if (isOut) {
          if (tsNum > maxOut) maxOut = tsNum;
        } else if (tsNum > maxIn) maxIn = tsNum;

        const r = await sql`
          INSERT INTO public.crm_message
            (conversation_id, message_id_wa, direction, content, media_type, status, sender_name, timestamp)
          VALUES
            (${conv.id}, ${messageid}, ${isOut ? "outgoing" : "incoming"},
             ${contentOf(m)}, ${mediaTypeOf(m)}, ${isOut ? "sent" : "delivered"},
             ${isOut ? null : m.senderName ?? pushName ?? null}, ${tsDate})
          ON CONFLICT (conversation_id, message_id_wa) DO NOTHING
          RETURNING id`;
        if (r.length > 0) msgsInserted++;
      }

      // 4. Refina last_*_at pela maior msg vista (mantém ordenação do inbox)
      if (maxTs > 0) {
        await sql`
          UPDATE public.crm_conversation SET
            last_message_at = GREATEST(COALESCE(last_message_at, to_timestamp(0)), ${toDate(maxTs)}),
            last_incoming_at = ${maxIn > 0 ? sql`GREATEST(COALESCE(last_incoming_at, to_timestamp(0)), ${toDate(maxIn)})` : sql`last_incoming_at`},
            last_outgoing_at = ${maxOut > 0 ? sql`GREATEST(COALESCE(last_outgoing_at, to_timestamp(0)), ${toDate(maxOut)})` : sql`last_outgoing_at`}
          WHERE id = ${conv.id}`;
      }
    }

    console.log(
      `   ${DRY ? "[DRY] " : ""}conversas: +${created} novas, ${updated} atualizadas | mensagens inseridas: ${msgsInserted}` +
        (DRY ? "" : ` | chats c/ msgs: ${chatsWithMsgs}, vazios: ${chatsEmpty}, erro: ${chatsErr}`)
    );
  }

  await sql.end();
  console.log(`\n=== ${DRY ? "DRY-RUN CONCLUÍDO (nada escrito)" : "CONCLUÍDO"} ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
