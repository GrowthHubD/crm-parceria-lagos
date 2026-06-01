/**
 * Índices parciais de kanban_task (Alt 04) — criados após a revisão de código.
 * Casam exatamente os predicados dos hot paths (só tarefas abertas):
 *   - dedup do create_task no runner: (source_automation_id, lead_id)
 *   - lembrete por reminderAt e legado por dueDate (cron de 1 min)
 *
 * Idempotente. Rodar: npx tsx scripts/apply-review-fix-indexes.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("→ idx_kanban_source_auto (dedup create_task, só abertas)...");
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_kanban_source_auto
      ON public.kanban_task(source_automation_id, lead_id)
      WHERE is_completed = false;
  `);

  console.log("→ idx_kanban_reminder_open (lembrete por reminderAt, só abertas)...");
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_kanban_reminder_open
      ON public.kanban_task(reminder_at)
      WHERE is_completed = false AND reminder_at IS NOT NULL;
  `);

  console.log("→ idx_kanban_due_open (lembrete legado por dueDate, só abertas)...");
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_kanban_due_open
      ON public.kanban_task(due_date)
      WHERE is_completed = false AND reminder_at IS NULL AND due_date IS NOT NULL;
  `);

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'kanban_task'
      AND indexname IN ('idx_kanban_source_auto','idx_kanban_reminder_open','idx_kanban_due_open')
    ORDER BY indexname`;
  console.log("\n✓ Índices ativos:");
  idx.forEach((i) => console.log(`  ${i.indexname}`));

  await sql.end();
  console.log("\n✅ Índices parciais de kanban_task aplicados.");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
