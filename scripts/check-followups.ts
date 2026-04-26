import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const followUps = await sql`
    SELECT a.id, a.name, a.description, a.trigger_type, a.trigger_config, a.is_active, a.created_at,
      (SELECT json_agg(s.config) FROM public.automation_step s WHERE s.automation_id = a.id) AS steps
    FROM public.automation a
    WHERE a.tenant_id = '00000000-0000-0000-0000-000000000001'
    ORDER BY a.created_at DESC;
  `;
  console.log(`\n→ ${followUps.length} automations no tenant GH:\n`);
  followUps.forEach((f) => {
    console.log(`  • ${f.name}`);
    console.log(`    trigger: ${f.trigger_type}, active=${f.is_active}`);
    console.log(`    config: ${JSON.stringify(f.trigger_config)}`);
    console.log(`    steps: ${JSON.stringify(f.steps)}`);
    console.log(`    created: ${new Date(f.created_at as Date).toISOString()}\n`);
  });

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
