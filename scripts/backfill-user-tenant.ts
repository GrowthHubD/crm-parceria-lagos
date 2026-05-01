import "dotenv/config";
import postgres from "postgres";

const GH_TENANT_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });

  console.log("→ Verificando tenant GH...");
  const [tenantRow] = await sql`SELECT id, slug FROM public.tenant WHERE id = ${GH_TENANT_ID} LIMIT 1`;
  if (!tenantRow) {
    console.error(`✗ Tenant GH (${GH_TENANT_ID}) não existe. Rode o seed de tenant primeiro.`);
    process.exit(1);
  }
  console.log(`✓ Tenant GH ok: ${tenantRow.slug}`);

  const orphans = await sql<Array<{ id: string; email: string; name: string; role: string }>>`
    SELECT u.id, u.email, u.name, u.role
    FROM public."user" u
    LEFT JOIN public.user_tenant ut ON ut.user_id = u.id
    WHERE ut.id IS NULL
  `;

  if (orphans.length === 0) {
    console.log("✓ Nenhum user órfão. Nada a fazer.");
    await sql.end();
    return;
  }

  console.log(`→ Encontrei ${orphans.length} user(s) sem vínculo:`);
  for (const u of orphans) console.log(`  - ${u.email} (${u.name}, role=${u.role})`);

  for (const u of orphans) {
    await sql`
      INSERT INTO public.user_tenant (user_id, tenant_id, role, is_default)
      VALUES (${u.id}, ${GH_TENANT_ID}, ${u.role}, true)
      ON CONFLICT (user_id, tenant_id) DO NOTHING
    `;
    console.log(`  ✓ ${u.email} vinculado ao tenant GH`);
  }

  await sql.end();
  console.log("✓ Backfill concluído");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
