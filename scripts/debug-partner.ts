import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const tenants = await sql`
    SELECT id, name, slug, is_platform_owner, is_partner, partner_id, plan, created_at
    FROM public.tenant
    ORDER BY created_at DESC;
  `;
  console.log(`\n→ ${tenants.length} tenants:\n`);
  tenants.forEach((t) => console.log(`  • ${t.name} (slug=${t.slug}, partner_id=${t.partner_id || "null"}, is_partner=${t.is_partner}, platform=${t.is_platform_owner})`));

  const wnums = await sql`
    SELECT wn.id, wn.tenant_id, wn.phone_number, wn.is_active, t.name as tenant_name
    FROM public.whatsapp_number wn
    LEFT JOIN public.tenant t ON wn.tenant_id = t.id
    ORDER BY wn.created_at DESC;
  `;
  console.log(`\n→ ${wnums.length} whatsapp_numbers:\n`);
  wnums.forEach((w) => console.log(`  • ${w.tenant_name} → ${w.phone_number} (active=${w.is_active})`));

  const pipelines = await sql`
    SELECT p.id, p.name, p.is_default, t.name as tenant_name
    FROM public.pipeline p
    LEFT JOIN public.tenant t ON p.tenant_id = t.id
    ORDER BY p.created_at DESC;
  `;
  console.log(`\n→ ${pipelines.length} pipelines:\n`);
  pipelines.forEach((p) => console.log(`  • ${p.tenant_name} → ${p.name} (default=${p.is_default})`));

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
