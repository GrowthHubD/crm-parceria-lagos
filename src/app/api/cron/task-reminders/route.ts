/**
 * Cron — varre tarefas com `dueDate` próxima e cria notificações pra
 * o assignee (responsável). Idempotente via unique constraint
 * `uq_notification_task_user (user_id, task_id, type='task_due')`.
 *
 * Uso recomendado: chamar a cada 15-30 min via cron-job.org / GitHub Actions.
 *   POST /api/cron/task-reminders
 *   Header: Authorization: Bearer ${CRON_SECRET}
 *
 * Critério: tarefas onde dueDate <= now()+24h, isCompleted=false e que ainda
 * não têm notification de tipo 'task_due' pra esse usuário/task.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { kanbanTask } from "@/lib/db/schema/kanban";
import { lead } from "@/lib/db/schema/pipeline";
import { notification } from "@/lib/db/schema/notifications";
import { and, eq, lte } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // dueDate é tipo DATE (só dia). Comparamos com strings YYYY-MM-DD.
    // "Próximas em 24h" = vence hoje ou amanhã.
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const horizonStr = tomorrow.toISOString().slice(0, 10); // "YYYY-MM-DD"

    // Busca tarefas que vencem até amanhã (inclui atrasadas), não-completas,
    // com responsável atribuído. Inclui leadName via LEFT JOIN.
    const dueTasks = await db
      .select({
        id: kanbanTask.id,
        tenantId: kanbanTask.tenantId,
        title: kanbanTask.title,
        dueDate: kanbanTask.dueDate,
        priority: kanbanTask.priority,
        assignedTo: kanbanTask.assignedTo,
        leadId: kanbanTask.leadId,
        leadName: lead.name,
      })
      .from(kanbanTask)
      .leftJoin(lead, eq(kanbanTask.leadId, lead.id))
      .where(
        and(
          eq(kanbanTask.isCompleted, false),
          lte(kanbanTask.dueDate, horizonStr)
        )
      )
      .limit(500);

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    const todayStr = now.toISOString().slice(0, 10);
    for (const t of dueTasks) {
      if (!t.assignedTo || !t.dueDate) {
        skipped++;
        continue;
      }
      // t.dueDate vem como string "YYYY-MM-DD" do tipo DATE
      const dueStr = String(t.dueDate);
      const isOverdue = dueStr < todayStr;
      const isToday = dueStr === todayStr;

      const title = isOverdue ? "Tarefa atrasada" : isToday ? "Tarefa hoje" : "Tarefa amanhã";
      const leadSuffix = t.leadName ? ` (${t.leadName})` : "";
      const timeLabel = isOverdue ? "vencida" : isToday ? "vence hoje" : "vence amanhã";
      const message = `${t.title}${leadSuffix} — ${timeLabel}`;

      try {
        await db
          .insert(notification)
          .values({
            tenantId: t.tenantId,
            userId: t.assignedTo,
            title,
            message,
            type: "task_due",
            module: "tasks",
            link: t.leadId ? `/tasks?taskId=${t.id}` : `/tasks`,
            taskId: t.id,
          })
          .onConflictDoNothing(); // dedup via uq_notification_task_user
        created++;
      } catch (e) {
        skipped++;
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: dueTasks.length,
      created,
      skipped,
      errorsSample: errors.slice(0, 3),
    });
  } catch (e) {
    console.error("[CRON] task-reminders failed:", e);
    return NextResponse.json(
      { error: "Erro interno", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
