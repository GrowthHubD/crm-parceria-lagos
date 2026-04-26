import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const r = await sql`
    SELECT contact_phone, contact_jid
    FROM public.crm_conversation
    WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
  `;
  console.log("Conversations:", r);
  await sql.end();
}
main().catch(console.error);
