/**
 * Cron — lembretes de tarefas. Cria notificação (sino) pro responsável quando
 * a tarefa atinge o reminderAt (hora marcada) ou, no legado, quando dueDate
 * vence até amanhã. Idempotente via uq_notification_task_user.
 *
 * A lógica vive em src/lib/tasks/reminders.ts e TAMBÉM roda dentro do
 * runAutomationTick (cron de 1 min) → reminders com precisão de ~1 min.
 * Esta rota fica como entrada externa opcional (cron-job.org / Actions).
 *
 *   POST /api/cron/task-reminders   Header: Authorization: Bearer ${CRON_SECRET}
 */
import { NextRequest, NextResponse } from "next/server";
import { processTaskReminders } from "@/lib/tasks/reminders";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const r = await processTaskReminders(500);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[CRON] task-reminders failed:", e);
    return NextResponse.json(
      { error: "Erro interno", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
