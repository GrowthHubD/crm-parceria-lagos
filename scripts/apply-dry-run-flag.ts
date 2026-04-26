/**
 * Adiciona coluna `dry_run` em automation_log.
 * Idempotente — roda múltiplas vezes sem erro.
 *
 * Uso: npx tsx scripts/apply-dry-run-flag.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
  });

  await sql`
    ALTER TABLE public.automation_log
    ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT false
  `;
  console.log("✓ coluna dry_run adicionada em automation_log");

  await sql`
    ALTER TABLE public.automation
    ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT false
  `;
  console.log("✓ coluna dry_run adicionada em automation");

  const [{ count }] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM public.automation_log WHERE dry_run = true
  `;
  console.log(`  logs com dry_run=true já no banco: ${count}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
