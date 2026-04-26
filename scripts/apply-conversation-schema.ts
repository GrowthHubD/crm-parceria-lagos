import "dotenv/config";
import postgres from "postgres";

const SQL = `
-- Adiciona flag de grupo + timestamps separados pra incoming/outgoing
ALTER TABLE public.crm_conversation
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_incoming_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_outgoing_at TIMESTAMP WITH TIME ZONE;

-- Backfill: conversas com contact_jid terminando em @g.us são grupo
UPDATE public.crm_conversation
SET is_group = TRUE
WHERE contact_jid LIKE '%@g.us' AND is_group = FALSE;

-- Índices pra performance do cron de follow-up
CREATE INDEX IF NOT EXISTS idx_conv_followup_lookup
  ON public.crm_conversation(tenant_id, is_group, last_outgoing_at)
  WHERE is_group = FALSE AND last_outgoing_at IS NOT NULL;
`;

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });
  console.log("→ ALTER TABLE crm_conversation...");
  await sql.unsafe(SQL);

  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name='crm_conversation' AND table_schema='public'
      AND column_name IN ('is_group','last_incoming_at','last_outgoing_at')
    ORDER BY column_name;
  `;
  console.log(`\n✓ ${cols.length}/3 colunas novas presentes:`);
  cols.forEach((c) => console.log(`  • ${c.column_name} (${c.data_type})`));

  const groupCount = await sql`SELECT COUNT(*)::int AS n FROM public.crm_conversation WHERE is_group = TRUE;`;
  console.log(`\n✓ ${groupCount[0].n} conversas marcadas como grupo (backfill).`);

  await sql.end();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
