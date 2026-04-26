import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const convs = await sql`
    SELECT id, contact_phone, contact_jid, created_at, last_message_at
    FROM public.crm_conversation
    ORDER BY created_at DESC
    LIMIT 20;
  `;
  console.log(`\n→ Conversations (${convs.length}):`);
  convs.forEach((c) => console.log(`  • ${c.contact_phone} | jid=${c.contact_jid?.slice(0, 40)} | created=${new Date(c.created_at as Date).toISOString()}`));

  const leads = await sql`
    SELECT id, phone, name, created_at, crm_conversation_id
    FROM public.lead
    ORDER BY created_at DESC
    LIMIT 20;
  `;
  console.log(`\n→ Leads (${leads.length}):`);
  leads.forEach((l) => console.log(`  • ${l.phone} | name=${l.name} | conv=${String(l.crm_conversation_id).slice(-6)} | created=${new Date(l.created_at as Date).toISOString()}`));

  const logs = await sql`
    SELECT
      al.id, al.status, al.scheduled_at, al.executed_at, al.error,
      a.name as auto_name,
      l.phone as lead_phone
    FROM public.automation_log al
    JOIN public.automation a ON a.id = al.automation_id
    LEFT JOIN public.lead l ON l.id = al.lead_id
    ORDER BY al.created_at DESC
    LIMIT 30;
  `;
  console.log(`\n→ Automation logs (${logs.length}):`);
  logs.forEach((l) => console.log(`  • [${l.status}] ${l.auto_name} → ${l.lead_phone} | sched=${new Date(l.scheduled_at as Date).toISOString().slice(0, 19)} | exec=${l.executed_at ? new Date(l.executed_at as Date).toISOString().slice(0, 19) : '-'} | err=${l.error ?? '-'}`));

  const msgs = await sql`
    SELECT id, conversation_id, direction, content, timestamp
    FROM public.crm_message
    WHERE direction = 'outgoing'
    ORDER BY timestamp DESC
    LIMIT 10;
  `;
  console.log(`\n→ Outgoing msgs gravadas (${msgs.length}):`);
  msgs.forEach((m) => console.log(`  • [${new Date(m.timestamp as Date).toISOString().slice(11, 19)}] ${String(m.content).slice(0, 60)}`));

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
