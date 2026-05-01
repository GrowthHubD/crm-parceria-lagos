/**
 * Adiciona coluna `task_id` em notification + unique (userId, taskId, type)
 * pra suportar lembretes de tarefas com dedup ao nível do banco.
 *
 * Idempotente — usa IF NOT EXISTS / DROP IF EXISTS.
 *
 * Uso: npx tsx scripts/apply-notification-task-id.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("→ Adicionando coluna task_id em notification...");
  await sql.unsafe(`
    ALTER TABLE public.notification
      ADD COLUMN IF NOT EXISTS task_id UUID
        REFERENCES public.kanban_task(id) ON DELETE CASCADE;
  `);

  console.log("→ Criando constraint unique uq_notification_task_user...");
  await sql.unsafe(`
    ALTER TABLE public.notification
      DROP CONSTRAINT IF EXISTS uq_notification_task_user;
    ALTER TABLE public.notification
      ADD CONSTRAINT uq_notification_task_user
      UNIQUE (user_id, task_id, type);
  `);

  // Verifica
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification' AND column_name = 'task_id';
  `;
  console.log("\n✓ Coluna criada:", cols[0]);

  const cons = await sql`
    SELECT conname FROM pg_constraint WHERE conname = 'uq_notification_task_user';
  `;
  console.log("✓ Constraint:", cons[0]?.conname ?? "(não criada)");

  await sql.end();
  console.log("\n✅ Migration concluída.");
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
