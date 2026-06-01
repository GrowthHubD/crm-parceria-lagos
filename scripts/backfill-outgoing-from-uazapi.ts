/**
 * Backfill das mensagens ENVIADAS (fromMe) que se perderam antes do fix do
 * webhook (que dropava `if (msg.fromMe) return`). Puxa o histórico da Uazapi
 * via POST /message/find (por conversa, paginado por offset) e insere as
 * outgoing faltantes em crm_message com ON CONFLICT DO NOTHING (dedup pela
 * unique (conversation_id, message_id_wa) — as enviadas pelo /send do CRM já
 * estão no banco e não duplicam).
 *
 * Uso:
 *   npx tsx scripts/backfill-outgoing-from-uazapi.ts <tenantId> [--dry]
 *
 * --dry: não escreve; conta quantas SERIAM inseridas (checando existência por
 *        message_id_wa) — bom pra validar antes do run real.
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });
import postgres from "postgres";

const TENANT_ID = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!TENANT_ID || TENANT_ID.startsWith("--")) {
  console.error("Uso: npx tsx scripts/backfill-outgoing-from-uazapi.ts <tenantId> [--dry]");
  process.exit(1);
}

const PAGE = 200;
const MAX_PAGES = 60; // teto de segurança por conversa (12k msgs)

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
  content?: { text?: string; caption?: string };
};

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

async function fetchPage(
  serverUrl: string,
  token: string,
  chatid: string,
  offset: number
): Promise<{ messages: UMsg[]; hasMore: boolean }> {
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/message/find`, {
    method: "POST",
    headers: { token, "Content-Type": "application/json" },
    body: JSON.stringify({ chatid, limit: PAGE, offset, sort: "-messageTimestamp" }),
  });
  if (!res.ok) throw new Error(`message/find ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const j = (await res.json()) as { messages?: UMsg[]; hasMore?: boolean };
  return { messages: j.messages ?? [], hasMore: !!j.hasMore };
}

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const [wn] = await sql<
    { id: string; server_url: string | null; uazapi_token: string; label: string }[]
  >`
    SELECT id, server_url, uazapi_token, label FROM public.whatsapp_number
    WHERE tenant_id = ${TENANT_ID} AND is_active = true LIMIT 1`;
  if (!wn) {
    console.error("Nenhum whatsapp_number ativo pro tenant", TENANT_ID);
    await sql.end();
    process.exit(1);
  }
  const serverUrl = wn.server_url ?? process.env.UAZAPI_BASE_URL ?? "https://api.uazapi.com";
  const token = wn.uazapi_token;
  console.log(`Tenant ${TENANT_ID} | wnum "${wn.label}" | server ${serverUrl} | DRY=${DRY}`);

  const convs = await sql<{ id: string; contact_jid: string; contact_phone: string }[]>`
    SELECT id, contact_jid, contact_phone FROM public.crm_conversation
    WHERE whatsapp_number_id = ${wn.id} AND is_group = false AND contact_jid IS NOT NULL`;
  console.log(`${convs.length} conversas\n`);

  let totalInserted = 0;
  let totalSeen = 0;
  let convChanged = 0;

  for (const conv of convs) {
    const chatid = conv.contact_jid;
    let offset = 0;
    let pages = 0;
    let insertedThisConv = 0;
    let maxTs = 0;

    while (pages < MAX_PAGES) {
      let page: { messages: UMsg[]; hasMore: boolean };
      try {
        page = await fetchPage(serverUrl, token, chatid, offset);
      } catch (e) {
        console.warn(`  [${conv.contact_phone}] erro offset=${offset}: ${(e as Error).message}`);
        break;
      }
      if (page.messages.length === 0) break;

      for (const m of page.messages) {
        if (m.fromMe !== true || m.isGroup === true) continue;
        const messageid = m.messageid ?? m.id ?? null;
        if (!messageid) continue;
        totalSeen++;
        const tsNum = Number(m.messageTimestamp) || Date.now();
        if (tsNum > maxTs) maxTs = tsNum;

        if (DRY) {
          const exists = await sql`
            SELECT 1 FROM public.crm_message
            WHERE conversation_id = ${conv.id} AND message_id_wa = ${messageid} LIMIT 1`;
          if (exists.length === 0) insertedThisConv++;
          continue;
        }

        const r = await sql`
          INSERT INTO public.crm_message
            (conversation_id, message_id_wa, direction, content, media_type, status, timestamp)
          VALUES
            (${conv.id}, ${messageid}, 'outgoing', ${contentOf(m)}, ${mediaTypeOf(m)}, 'sent', ${new Date(tsNum)})
          ON CONFLICT (conversation_id, message_id_wa) DO NOTHING
          RETURNING id`;
        if (r.length > 0) insertedThisConv++;
      }

      pages++;
      offset += PAGE;
      if (!page.hasMore) break;
    }

    if (insertedThisConv > 0) {
      totalInserted += insertedThisConv;
      convChanged++;
      if (!DRY && maxTs > 0) {
        await sql`
          UPDATE public.crm_conversation
          SET last_outgoing_at = GREATEST(COALESCE(last_outgoing_at, to_timestamp(0)), ${new Date(maxTs)}),
              last_message_at = GREATEST(COALESCE(last_message_at, to_timestamp(0)), ${new Date(maxTs)})
          WHERE id = ${conv.id}`;
      }
      console.log(`  [${conv.contact_phone}] ${DRY ? "a inserir" : "inseridas"}: ${insertedThisConv}`);
    }
  }

  console.log(
    `\n=== ${DRY ? "DRY-RUN" : "CONCLUÍDO"} | conversas afetadas: ${convChanged} | outgoing ${
      DRY ? "a inserir" : "inseridas"
    }: ${totalInserted} (fromMe vistas no Uazapi: ${totalSeen}) ===`
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
