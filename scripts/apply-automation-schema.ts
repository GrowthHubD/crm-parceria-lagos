import "dotenv/config";
import postgres from "postgres";

const SQL = `
ALTER TABLE public.automation
  ADD COLUMN IF NOT EXISTS audience_filter JSONB,
  ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_automation_trigger_active
  ON public.automation(trigger_type, is_active)
  WHERE is_active = TRUE;
`;

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });
  console.log("→ ALTER TABLE automation...");
  await sql.unsafe(SQL);

  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name='automation' AND table_schema='public'
      AND column_name IN ('audience_filter', 'last_fired_at')
    ORDER BY column_name;
  `;
  console.log(`\n✓ ${cols.length}/2 colunas novas presentes:`);
  cols.forEach((c) => console.log(`  • ${c.column_name} (${c.data_type})`));

  await sql.end();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
