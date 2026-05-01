/**
 * Valida que um tenant teste foi provisionado corretamente.
 * Uso: npx tsx scripts/validate-test-tenant.ts <tenantId> [userId]
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const TID = process.argv[2];
const UID = process.argv[3];
if (!TID) { console.error("Usage: tsx scripts/validate-test-tenant.ts <tenantId> [userId]"); process.exit(1); }

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("=== TENANT ===");
  const t = await sql`SELECT name, slug, plan, status, partner_id, uazapi_instance_id FROM tenant WHERE id = ${TID};`;
  console.log(t[0]);

  console.log("\n=== WHATSAPP_NUMBER ===");
  const w = await sql`SELECT id, label, phone_number, uazapi_session, length(uazapi_token) as tok_len, is_active FROM whatsapp_number WHERE tenant_id = ${TID};`;
  console.log(w[0]);

  if (UID) {
    console.log("\n=== USER ===");
    const u = await sql`SELECT id, email, name, role FROM public.user WHERE id = ${UID};`;
    console.log(u[0]);

    console.log("\n=== USER_TENANT ===");
    const ut = await sql`SELECT tenant_id, role, is_default FROM user_tenant WHERE user_id = ${UID};`;
    console.log(ut);
  }

  console.log("\n=== PIPELINE ===");
  const p = await sql`SELECT name, is_default FROM pipeline WHERE tenant_id = ${TID};`;
  console.log(p[0]);

  console.log("\n=== STAGES ===");
  const stages = await sql`SELECT name, "order", color, is_won FROM pipeline_stage WHERE tenant_id = ${TID} ORDER BY "order";`;
  stages.forEach((s) => console.log(" ", s.order, s.name, s.color, "isWon=" + s.is_won));

  await sql.end();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
