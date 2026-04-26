import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("\n=== Leads (duplicatas?) ===");
  const leads = await sql`
    SELECT phone, COUNT(*) as n, array_agg(id) as ids, array_agg(created_at) as cas
    FROM public.lead GROUP BY phone ORDER BY n DESC LIMIT 10;
  `;
  console.log(leads);

  console.log("\n=== Automation logs do Gabriel / welcome ===");
  const logs = await sql`
    SELECT al.id, al.status, al.lead_id, l.phone, l.name, al.scheduled_at, al.executed_at, al.created_at
    FROM public.automation_log al
    LEFT JOIN public.lead l ON l.id = al.lead_id
    ORDER BY al.created_at DESC LIMIT 20;
  `;
  console.log(logs);

  console.log("\n=== Constraints UNIQUE em lead e crm_message ===");
  const constraints = await sql`
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
    WHERE tablename IN ('lead','crm_message','automation_log')
      AND (indexdef ILIKE '%UNIQUE%' OR indexname LIKE 'uq_%' OR indexname LIKE 'pk_%');
  `;
  console.log(constraints);

  console.log("\n=== Recent outgoing messages (welcome) ===");
  const outs = await sql`
    SELECT id, conversation_id, direction, content, timestamp, created_at
    FROM public.crm_message
    WHERE direction = 'outgoing'
    ORDER BY created_at DESC LIMIT 10;
  `;
  console.log(outs);

  await sql.end();
}

main().catch(console.error);
