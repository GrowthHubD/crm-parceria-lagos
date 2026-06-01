/**
 * Idempotência do trigger stage_enter + FK do create_task (Alt 04).
 *
 * 1. Limpa logs stage_enter duplicados (legado, antes do onConflictDoNothing).
 * 2. Cria partial unique index uq_autolog_stage_task → impede log duplicado ao
 *    reentrar na etapa (espelha uq_autolog_welcome).
 * 3. Cria a FK kanban_task.source_automation_id → automation(id) (declarada sem
 *    .references() no drizzle pra evitar ciclo de import).
 *
 * Rodar DEPOIS do `npm run db:push` (precisa das colunas novas em kanban_task):
 *   npx tsx scripts/apply-stage-task-dedup-index.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  // Colunas novas de kanban_task (Alt 04) — aplicadas via SQL idempotente em vez
  // de drizzle-kit push (mais controlado; sem prompt interativo no Windows).
  console.log("→ Adicionando colunas de kanban_task (due_at, reminder_at, recurrence, source)...");
  await sql.unsafe(`
    ALTER TABLE public.kanban_task
      ADD COLUMN IF NOT EXISTS due_at timestamptz,
      ADD COLUMN IF NOT EXISTS reminder_at timestamptz,
      ADD COLUMN IF NOT EXISTS recurrence_every_days integer,
      ADD COLUMN IF NOT EXISTS recurrence_until timestamptz,
      ADD COLUMN IF NOT EXISTS source_automation_id uuid,
      ADD COLUMN IF NOT EXISTS source_step_id uuid;
    CREATE INDEX IF NOT EXISTS idx_kanban_reminder_at ON public.kanban_task(reminder_at);
  `);
  console.log("  ✓ colunas + índice idx_kanban_reminder_at OK");

  console.log("→ Limpando logs stage_enter duplicados (mantém o mais antigo)...");
  const deleted = await sql.unsafe(`
    DELETE FROM public.automation_log a
    USING public.automation_log b
    WHERE a.trigger_type = 'stage_enter'
      AND b.trigger_type = 'stage_enter'
      AND a.automation_id = b.automation_id
      AND a.lead_id = b.lead_id
      AND COALESCE(a.step_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(b.step_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.id > b.id
    RETURNING a.id;
  `);
  console.log(`  ✓ ${deleted.length} logs duplicados removidos`);

  console.log("→ Criando partial unique index uq_autolog_stage_task...");
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_autolog_stage_task
      ON public.automation_log(automation_id, lead_id, step_id)
      WHERE trigger_type = 'stage_enter';
  `);

  console.log("→ Criando FK kanban_task.source_automation_id → automation(id)...");
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_kanban_task_source_automation') THEN
        ALTER TABLE public.kanban_task
          ADD CONSTRAINT fk_kanban_task_source_automation
          FOREIGN KEY (source_automation_id) REFERENCES public.automation(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  const idx = await sql`
    SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'uq_autolog_stage_task'`;
  console.log("\n✓ Index ativo:");
  idx.forEach((i) => console.log(`  ${i.indexdef}`));

  await sql.end();
  console.log("\n✅ Idempotência de stage_enter + FK do create_task garantidas.");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
