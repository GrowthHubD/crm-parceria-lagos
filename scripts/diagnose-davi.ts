import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("=== AUTOMATIONS lead_inactive ===");
  const autos = await sql`SELECT id, name, trigger_config, is_active, dry_run FROM public.automation WHERE trigger_type='lead_inactive' ORDER BY name`;
  autos.forEach((a: { name: string; is_active: boolean; dry_run: boolean; trigger_config: unknown }) =>
    console.log(`  ${a.name} | active=${a.is_active} | dry=${a.dry_run} | cfg=${JSON.stringify(a.trigger_config)}`)
  );

  console.log("\n=== CONV DO DAVI (5518997714802) ===");
  const convs = await sql`SELECT c.id, c.contact_phone, c.last_outgoing_at, c.last_incoming_at, c.last_message_at, c.is_group FROM public.crm_conversation c WHERE c.contact_phone LIKE '%99771%' OR c.contact_phone = '5518997714802'`;
  convs.forEach((c: { id: string; contact_phone: string; last_outgoing_at: Date | null; last_incoming_at: Date | null; last_message_at: Date | null; is_group: boolean }) =>
    console.log(`  phone=${c.contact_phone} group=${c.is_group} out=${c.last_outgoing_at?.toISOString() ?? "null"} in=${c.last_incoming_at?.toISOString() ?? "null"} msg=${c.last_message_at?.toISOString() ?? "null"}`)
  );

  console.log("\n=== LEAD DO DAVI ===");
  const leads = await sql`SELECT id, name, phone, crm_conversation_id, tenant_id FROM public.lead WHERE phone LIKE '%99771%' OR phone = '5518997714802'`;
  leads.forEach((l: { id: string; name: string; phone: string; crm_conversation_id: string | null; tenant_id: string }) =>
    console.log(`  ${l.name} phone=${l.phone} convId=${l.crm_conversation_id ?? "NULL"} tenant=${l.tenant_id}`)
  );

  console.log("\n=== LOGS RECENTES DO DAVI (10) ===");
  const logs = await sql`
    SELECT a.name, l.status, l.dry_run, l.created_at, l.executed_at, l.error
    FROM public.automation_log l
    JOIN public.automation a ON a.id = l.automation_id
    LEFT JOIN public.lead ld ON ld.id = l.lead_id
    WHERE ld.phone LIKE '%99771%' OR ld.phone = '5518997714802'
    ORDER BY l.created_at DESC LIMIT 10
  `;
  logs.forEach((x: { name: string; status: string; dry_run: boolean; created_at: Date; executed_at: Date | null; error: string | null }) =>
    console.log(`  ${x.name} | status=${x.status} dry=${x.dry_run} created=${x.created_at?.toISOString?.().slice(11, 19)} executed=${x.executed_at?.toISOString?.().slice(11, 19) ?? "-"} ${x.error ?? ""}`)
  );

  await sql.end();
}
main().catch(console.error);
