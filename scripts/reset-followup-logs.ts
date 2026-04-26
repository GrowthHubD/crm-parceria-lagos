import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const deleted = await sql`
    DELETE FROM public.automation_log
    WHERE trigger_type = 'lead_inactive'
    RETURNING id;
  `;
  console.log(`✓ ${deleted.length} logs de follow-up removidos`);
  await sql.end();
}
main().catch(console.error);
