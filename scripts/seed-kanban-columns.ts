/**
 * Cria as colunas default do Kanban (To Do / In Progress / Done) pro tenant GH.
 * Idempotente — se já existem, skipa.
 *
 * Roda local com `.env.local` apontando pra prod:
 *   npx tsx scripts/seed-kanban-columns.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

import postgres from "postgres";

const GH_TENANT_ID = "00000000-0000-0000-0000-000000000001";

const COLUMNS = [
  { name: "To Do", order: 1, color: "#8B8B9E" },
  { name: "In Progress", order: 2, color: "#FFB800" },
  { name: "Done", order: 3, color: "#00D68F" },
];

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("→ Garantindo tenant GH existe...");
  await sql.unsafe(`
    INSERT INTO public.tenant (id, name, slug, is_platform_owner, status, plan)
    VALUES ($1, 'Growth Hub', 'gh', true, 'active', 'enterprise')
    ON CONFLICT (id) DO NOTHING;
  `, [GH_TENANT_ID]);

  console.log(`→ Inserindo ${COLUMNS.length} colunas default no tenant GH...`);
  for (const col of COLUMNS) {
    const result = await sql.unsafe(`
      INSERT INTO public.kanban_column (name, "order", color, tenant_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
      RETURNING id;
    `, [col.name, col.order, col.color, GH_TENANT_ID]);
    console.log(`  ${result.length > 0 ? "[OK]" : "[SKIP — já existe]"} ${col.name}`);
  }

  // Verifica final
  const rows = await sql`
    SELECT name, "order", color FROM public.kanban_column
    WHERE tenant_id = ${GH_TENANT_ID}
    ORDER BY "order";
  `;
  console.log(`\n✓ Tenant GH agora tem ${rows.length} coluna(s):`);
  rows.forEach((r) => console.log(`  ${r.order}. ${r.name} (${r.color})`));

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
