import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const SQL = `
CREATE TABLE IF NOT EXISTS public.automation_step_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID NOT NULL REFERENCES public.automation_step(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES public.automation(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  step_type TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_step_version_automation
  ON public.automation_step_version(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_step_version_step
  ON public.automation_step_version(step_id);
`;

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  await sql.unsafe(SQL);
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'automation_step_version' AND table_schema = 'public'
    ORDER BY ordinal_position;
  `;
  console.log(`✓ Tabela automation_step_version criada com ${cols.length} colunas:`);
  cols.forEach((c) => console.log(`  • ${c.column_name}`));
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
