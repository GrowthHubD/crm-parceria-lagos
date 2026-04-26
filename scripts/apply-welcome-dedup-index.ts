/**
 * Adiciona denormalização de trigger_type em automation_log + partial unique index
 * pra impedir welcome duplicado ao nível do banco (independe de código aplicativo).
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("→ Adicionando coluna trigger_type em automation_log...");
  await sql.unsafe(`
    ALTER TABLE public.automation_log
      ADD COLUMN IF NOT EXISTS trigger_type TEXT;
  `);

  console.log("→ Backfill trigger_type com valores da automation...");
  const backfilled = await sql.unsafe(`
    UPDATE public.automation_log al
    SET trigger_type = a.trigger_type
    FROM public.automation a
    WHERE al.automation_id = a.id AND al.trigger_type IS NULL
    RETURNING al.id;
  `);
  console.log(`  ✓ ${backfilled.length} rows atualizadas`);

  // Limpa logs duplicados de first_message (mantém o mais antigo por auto+lead)
  console.log("→ Limpando automation_logs duplicados de first_message...");
  const deleted = await sql.unsafe(`
    DELETE FROM public.automation_log a
    USING public.automation_log b
    WHERE a.trigger_type = 'first_message'
      AND b.trigger_type = 'first_message'
      AND a.automation_id = b.automation_id
      AND a.lead_id = b.lead_id
      AND a.id > b.id
    RETURNING a.id;
  `);
  console.log(`  ✓ ${deleted.length} logs duplicados removidos`);

  console.log("→ Criando partial unique index uq_autolog_welcome...");
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_autolog_welcome
      ON public.automation_log(automation_id, lead_id)
      WHERE trigger_type = 'first_message';
  `);

  // Verifica
  const idx = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE indexname = 'uq_autolog_welcome';
  `;
  console.log(`\n✓ Index ativo:`);
  idx.forEach((i) => console.log(`  ${i.indexdef}`));

  await sql.end();
  console.log("\n✅ Dedup de welcome garantida ao nível do banco.");
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
