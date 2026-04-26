/**
 * Reseta COMPLETAMENTE uma conversa (por phone) — deleta mensagens,
 * automation_logs, lead e a conversation. Útil pra testar welcome + follow-up
 * do zero como se o contato nunca tivesse falado.
 *
 * Uso: npx tsx scripts/reset-conversation.ts 5521978477520
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error("Uso: npx tsx scripts/reset-conversation.ts <phone>");
    process.exit(1);
  }

  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const convs = await sql<{ id: string; contact_phone: string }[]>`
    SELECT id, contact_phone FROM public.crm_conversation WHERE contact_phone = ${phone}
  `;
  console.log(`Conversations encontradas pra ${phone}: ${convs.length}`);

  const leads = await sql<{ id: string; name: string | null }[]>`
    SELECT id, name FROM public.lead WHERE phone = ${phone}
  `;
  console.log(`Leads encontrados: ${leads.length}`);

  for (const l of leads) {
    const delLogs = await sql`DELETE FROM public.automation_log WHERE lead_id = ${l.id}`;
    console.log(`  ${l.name ?? "?"} (${l.id}): ${delLogs.count} logs deletados`);
  }

  for (const c of convs) {
    const delMsgs = await sql`DELETE FROM public.crm_message WHERE conversation_id = ${c.id}`;
    console.log(`  conv ${c.id}: ${delMsgs.count} msgs deletadas`);
  }

  const delLeads = await sql`DELETE FROM public.lead WHERE phone = ${phone}`;
  console.log(`Leads deletados: ${delLeads.count}`);

  const delConvs = await sql`DELETE FROM public.crm_conversation WHERE contact_phone = ${phone}`;
  console.log(`Conversations deletadas: ${delConvs.count}`);

  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
