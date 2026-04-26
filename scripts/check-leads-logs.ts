import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const leads = await sql`
    SELECT id, name, phone FROM public.lead
    WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
  `;
  console.log("\nLeads atuais:");
  leads.forEach((l) => console.log(`  ${l.id}  ${l.name} (${l.phone})`));

  const logs = await sql`
    SELECT automation_id, lead_id, status FROM public.automation_log;
  `;
  console.log("\nAutomation logs existentes:");
  logs.forEach((l) => console.log(`  auto=${l.automation_id}  lead=${l.lead_id}  status=${l.status}`));

  await sql.end();
}
main().catch(console.error);
