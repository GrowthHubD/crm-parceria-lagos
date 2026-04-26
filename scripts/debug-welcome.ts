import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  console.log("AUTOMATION_DRY_RUN:", process.env.AUTOMATION_DRY_RUN);

  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const autos = await sql`
    SELECT id, name, trigger_type, is_active, last_fired_at
    FROM public.automation
    WHERE trigger_type = 'first_message'
    ORDER BY created_at DESC;
  `;
  console.log(`\n→ ${autos.length} automation(s) first_message:`);
  autos.forEach((a) => console.log(`  • ${a.name} (id=${String(a.id).slice(-6)}, active=${a.is_active})`));

  const convs = await sql`
    SELECT id, contact_phone, is_group, last_message_at, unread_count, created_at
    FROM public.crm_conversation
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT 10;
  `;
  console.log(`\n→ ${convs.length} conversation(s) recentes:`);
  convs.forEach((c) => {
    const recent = new Date(c.last_message_at as Date).toLocaleString("pt-BR");
    console.log(`  • ${c.contact_phone} (group=${c.is_group}, unread=${c.unread_count}) last_msg=${recent}`);
  });

  const leads = await sql`
    SELECT id, name, phone, source, created_at, crm_conversation_id
    FROM public.lead
    ORDER BY created_at DESC
    LIMIT 10;
  `;
  console.log(`\n→ ${leads.length} lead(s) recentes:`);
  leads.forEach((l) => console.log(`  • ${l.name} (${l.phone}, src=${l.source})`));

  const logs = await sql`
    SELECT l.id, a.name as auto_name, l.status, l.scheduled_at, l.executed_at, l.error
    FROM public.automation_log l
    JOIN public.automation a ON a.id = l.automation_id
    ORDER BY l.created_at DESC
    LIMIT 10;
  `;
  console.log(`\n→ ${logs.length} automation_log recentes:`);
  logs.forEach((l) => console.log(`  • [${l.status}] ${l.auto_name} — err=${l.error ?? "-"}`));

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
