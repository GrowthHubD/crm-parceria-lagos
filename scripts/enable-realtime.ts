/**
 * Habilita Realtime em crm_message e crm_conversation via Supabase publication.
 * Idempotente.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const SQL = `
-- Adiciona tabelas à publication do Realtime (idempotente)
DO $$
BEGIN
  -- crm_message
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'crm_message'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_message;
  END IF;

  -- crm_conversation
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'crm_conversation'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_conversation;
  END IF;
END $$;
`;

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });
  await sql.unsafe(SQL);

  const rows = await sql`
    SELECT tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename IN ('crm_message','crm_conversation')
    ORDER BY tablename;
  `;
  console.log(`✓ ${rows.length}/2 tabelas em supabase_realtime:`);
  rows.forEach((r) => console.log(`  • ${r.tablename}`));

  await sql.end();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
