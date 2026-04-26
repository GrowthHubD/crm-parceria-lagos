import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("=== WELCOME automations ATIVAS ===");
  const autos = await sql`SELECT id, name, is_active, dry_run FROM public.automation WHERE trigger_type='first_message' ORDER BY name`;
  console.log(`total=${autos.length}`);
  autos.forEach((a: { name: string; is_active: boolean; dry_run: boolean; id: string }) =>
    console.log(`  ${a.name} | active=${a.is_active} dry=${a.dry_run} id=${a.id}`)
  );

  console.log("\n=== PARTIAL UNIQUE INDEX existe? ===");
  const idx = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='automation_log' AND indexname='uq_autolog_welcome'`;
  console.log(idx.length ? `  ✓ ${idx[0].indexdef}` : "  ✗ NÃO EXISTE — welcome vai duplicar!");

  console.log("\n=== LOGS WELCOME ÚLTIMAS 30min ===");
  const logs = await sql`
    SELECT a.name as auto_name, l.trigger_type, l.status, l.created_at, ld.name as lead_name, ld.id as lead_id, l.automation_id
    FROM public.automation_log l
    JOIN public.automation a ON a.id = l.automation_id
    LEFT JOIN public.lead ld ON ld.id = l.lead_id
    WHERE l.created_at > now() - interval '30 minutes'
      AND (l.trigger_type='first_message' OR a.trigger_type='first_message')
    ORDER BY l.created_at DESC
  `;
  console.log(`logs=${logs.length}`);
  logs.forEach((x: { auto_name: string; status: string; created_at: Date; lead_name: string | null; lead_id: string | null; automation_id: string; trigger_type: string | null }) =>
    console.log(`  ${x.auto_name} → ${x.lead_name ?? "?"} (${x.lead_id?.slice(0,8)}) | ${x.status} trigger=${x.trigger_type} created=${x.created_at.toISOString().slice(11, 19)} autoId=${x.automation_id.slice(0,8)}`)
  );

  console.log("\n=== CONVERSATIONS NOVAS ÚLTIMAS 30min ===");
  const convs = await sql`SELECT id, contact_phone, created_at FROM public.crm_conversation WHERE created_at > now() - interval '30 minutes' ORDER BY created_at DESC LIMIT 5`;
  convs.forEach((c: { contact_phone: string; created_at: Date; id: string }) =>
    console.log(`  ${c.contact_phone} created=${c.created_at.toISOString().slice(11, 19)} id=${c.id.slice(0,8)}`)
  );

  await sql.end();
}
main().catch(console.error);
