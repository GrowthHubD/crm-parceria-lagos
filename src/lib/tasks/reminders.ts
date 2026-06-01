/**
 * Processa lembretes de tarefas → cria `notification` (sino) pro responsável.
 *
 * Critério (task não-completa):
 *   (a) reminderAt já vencido (lembrete pontual no horário — Alt 04), OU
 *   (b) sem reminderAt mas dueDate vencendo até amanhã (legado dueDate-only).
 *
 * Dedup via unique `uq_notification_task_user (user_id, task_id, type)` +
 * onConflictDoNothing → cada tarefa gera no máximo 1 notificação task_due
 * (cada ocorrência recorrente é uma task nova, com taskId novo → notifica de novo).
 *
 * Chamado pelo cron de 1 min (runAutomationTick) e pela rota /api/cron/task-reminders.
 */
import { db } from "../db";
import { kanbanTask } from "../db/schema/kanban";
import { lead } from "../db/schema/pipeline";
import { notification } from "../db/schema/notifications";
import { and, eq, lte, or, isNull, isNotNull } from "drizzle-orm";
import { formatDateBRT } from "./schedule";

export interface ReminderResult {
  scanned: number;
  created: number;
  skipped: number;
}

export async function processTaskReminders(limit = 500): Promise<ReminderResult> {
  const now = new Date();
  // Dias-parede em BRT (igual ao dueDate gravado pelo Alt 04) — sem isto, entre
  // 21h-23h59 BRT a data UTC já virou e o rótulo "vence hoje/amanhã" saía errado.
  const tomorrowStr = formatDateBRT(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const todayStr = formatDateBRT(now);

  const dueTasks = await db
    .select({
      id: kanbanTask.id,
      tenantId: kanbanTask.tenantId,
      title: kanbanTask.title,
      dueDate: kanbanTask.dueDate,
      reminderAt: kanbanTask.reminderAt,
      assignedTo: kanbanTask.assignedTo,
      leadId: kanbanTask.leadId,
      leadName: lead.name,
    })
    .from(kanbanTask)
    .leftJoin(lead, eq(kanbanTask.leadId, lead.id))
    .where(
      and(
        eq(kanbanTask.isCompleted, false),
        or(
          and(isNotNull(kanbanTask.reminderAt), lte(kanbanTask.reminderAt, now)),
          and(
            isNull(kanbanTask.reminderAt),
            isNotNull(kanbanTask.dueDate),
            lte(kanbanTask.dueDate, tomorrowStr)
          )
        )
      )
    )
    .limit(limit);

  let created = 0;
  let skipped = 0;

  for (const t of dueTasks) {
    if (!t.assignedTo) {
      skipped++;
      continue;
    }
    const dueStr = t.dueDate ? String(t.dueDate) : null;
    const overdue = dueStr ? dueStr < todayStr : false;
    const when = dueStr
      ? overdue
        ? "vencida"
        : dueStr === todayStr
          ? "vence hoje"
          : "vence amanhã"
      : "lembrete";
    const title = overdue ? "Tarefa atrasada" : "Lembrete de tarefa";
    const leadSuffix = t.leadName ? ` (${t.leadName})` : "";

    try {
      await db
        .insert(notification)
        .values({
          tenantId: t.tenantId,
          userId: t.assignedTo,
          title,
          message: `${t.title}${leadSuffix} — ${when}`,
          type: "task_due",
          module: "tasks",
          link: `/tasks?taskId=${t.id}`,
          taskId: t.id,
        })
        .onConflictDoNothing();
      created++;
    } catch {
      skipped++;
    }
  }

  return { scanned: dueTasks.length, created, skipped };
}
