import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("=== Conversas dos últimos 5 min ===");
  const convs = await sql`
    SELECT id, contact_phone, contact_push_name, last_incoming_at, last_message_at, is_group
    FROM public.crm_conversation
    WHERE created_at > now() - interval '5 minutes' OR last_message_at > now() - interval '5 minutes'
    ORDER BY last_message_at DESC NULLS LAST
  `;
  console.log(`total: ${convs.length}`);
  convs.forEach((c: any) =>
    console.log(`  ${c.contact_phone} (${c.contact_push_name ?? "?"}) | group=${c.is_group} | lastIn=${c.last_incoming_at?.toISOString().slice(11,19) ?? "-"} | lastMsg=${c.last_message_at?.toISOString().slice(11,19) ?? "-"}`)
  );

  console.log("\n=== Msgs dos últimos 5 min ===");
  const msgs = await sql`
    SELECT m.direction, m.content, m.timestamp, c.contact_phone
    FROM public.crm_message m
    JOIN public.crm_conversation c ON c.id = m.conversation_id
    WHERE m.timestamp > now() - interval '5 minutes'
    ORDER BY m.timestamp DESC LIMIT 10
  `;
  console.log(`total: ${msgs.length}`);
  msgs.forEach((m: any) =>
    console.log(`  [${m.direction}] ${m.contact_phone}: ${(m.content ?? "(no content)").slice(0, 60)}`)
  );

  console.log("\n=== Leads dos últimos 5 min ===");
  const leads = await sql`
    SELECT id, name, phone, created_at, crm_conversation_id
    FROM public.lead
    WHERE created_at > now() - interval '5 minutes'
    ORDER BY created_at DESC
  `;
  console.log(`total: ${leads.length}`);
  leads.forEach((l: any) =>
    console.log(`  ${l.name} (${l.phone}) convId=${l.crm_conversation_id?.slice(0,8) ?? "NULL"}`)
  );

  console.log("\n=== Logs automação últimos 5 min ===");
  const logs = await sql`
    SELECT a.name, l.status, l.created_at, l.error
    FROM public.automation_log l
    JOIN public.automation a ON a.id = l.automation_id
    WHERE l.created_at > now() - interval '5 minutes'
    ORDER BY l.created_at DESC LIMIT 10
  `;
  console.log(`total: ${logs.length}`);
  logs.forEach((x: any) => console.log(`  ${x.name} | status=${x.status} ${x.error ?? ""}`));

  await sql.end();
}
main().catch(console.error);
