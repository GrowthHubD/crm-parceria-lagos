import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const convId = "a9bade4a-715f-40d4-812a-cb765cf8ec66";

  console.log("\n=== Contagem de msgs por ID (dup?) ===");
  const dups = await sql`
    SELECT id, COUNT(*) AS n FROM public.crm_message
    WHERE conversation_id = ${convId}
    GROUP BY id HAVING COUNT(*) > 1;
  `;
  console.log(`IDs duplicados: ${dups.length}`);

  console.log("\n=== Últimas msgs outgoing ===");
  const msgs = await sql`
    SELECT id, content, timestamp
    FROM public.crm_message
    WHERE conversation_id = ${convId} AND direction = 'outgoing'
    ORDER BY timestamp DESC LIMIT 15;
  `;
  msgs.forEach((m) => {
    const t = new Date(m.timestamp as Date).toLocaleTimeString("pt-BR");
    console.log(`  [${t}] ${String(m.content ?? "").slice(0, 60)}`);
  });

  console.log("\n=== Automation logs sent pro Davi ===");
  const logs = await sql`
    SELECT al.id, a.name, al.scheduled_at, al.executed_at
    FROM public.automation_log al
    JOIN public.automation a ON a.id = al.automation_id
    WHERE al.lead_id IN (SELECT id FROM public.lead WHERE phone = '5518997714802')
    ORDER BY al.created_at DESC LIMIT 10;
  `;
  logs.forEach((l) => {
    const e = l.executed_at ? new Date(l.executed_at as Date).toLocaleTimeString("pt-BR") : "-";
    console.log(`  ${l.name} executed=${e}`);
  });

  await sql.end();
}

main().catch(console.error);
