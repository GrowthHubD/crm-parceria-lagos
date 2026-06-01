/**
 * Agendamento de tarefas (Alt 04 — gerar tarefa ao mover lead de etapa).
 *
 * Brasil aboliu o horário de verão em 2019 → BRT = UTC-3 fixo. Por isso
 * calculamos a hora-parede com offset -3 direto (simples e correto pro fuso
 * atual do país), sem depender de tz database em runtime de Worker.
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

/** Config do step `create_task` (gravado em automation_step.config jsonb). */
export interface CreateTaskStepConfig {
  titleTemplate?: string;
  descriptionTemplate?: string;
  assigneeMode?: "same_as_lead" | "fixed_user";
  fixedUserId?: string;
  columnId?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  dueAfterDays?: number;
  dueAfterHours?: number;
  dueTime?: string; // "HH:mm" interpretado em BRT
  reminderMinutesBefore?: number;
  recurEveryDays?: number;
  recurMaxOccurrences?: number;
}

/** "YYYY-MM-DD" do dia (parede BRT) de um instante. */
export function formatDateBRT(instant: Date): string {
  const w = new Date(instant.getTime() - BRT_OFFSET_MS);
  return `${w.getUTCFullYear()}-${String(w.getUTCMonth() + 1).padStart(2, "0")}-${String(
    w.getUTCDate()
  ).padStart(2, "0")}`;
}

/** Aplica HH:mm (parede BRT) ao dia BRT do instante base, retornando o UTC. */
function setTimeBRT(baseInstant: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const w = new Date(baseInstant.getTime() - BRT_OFFSET_MS);
  // parede BRT h:m no dia (y,mo,d) → UTC = h+3
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), h + 3, m, 0, 0));
}

export interface TaskSchedule {
  dueAt: Date;
  reminderAt: Date | null;
  dueDate: string; // YYYY-MM-DD (BRT) — projeção pro tipo DATE legado
}

/** Calcula dueAt/reminderAt/dueDate a partir do config e do "agora". */
export function computeTaskSchedule(
  cfg: CreateTaskStepConfig,
  now: Date = new Date()
): TaskSchedule {
  const offsetMs =
    (cfg.dueAfterDays ?? 0) * 86_400_000 + (cfg.dueAfterHours ?? 0) * 3_600_000;
  let due = new Date(now.getTime() + offsetMs);
  if (cfg.dueTime && /^\d{1,2}:\d{2}$/.test(cfg.dueTime)) {
    due = setTimeBRT(due, cfg.dueTime);
  }
  const reminderAt =
    cfg.reminderMinutesBefore != null && cfg.reminderMinutesBefore >= 0
      ? new Date(due.getTime() - cfg.reminderMinutesBefore * 60_000)
      : null;
  return { dueAt: due, reminderAt, dueDate: formatDateBRT(due) };
}
