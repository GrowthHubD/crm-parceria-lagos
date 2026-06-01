import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  date,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { user } from "./users";
import { tenant } from "./tenants";
import { lead } from "./pipeline";

// ============================================
// KANBAN / TASKS
// ============================================

export const kanbanColumn = pgTable("kanban_column", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kanbanTask = pgTable(
  "kanban_task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id").references(() => lead.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    columnId: uuid("column_id")
      .notNull()
      .references(() => kanbanColumn.id),
    assignedTo: text("assigned_to")
      .notNull()
      .references(() => user.id),
    dueDate: date("due_date"),
    priority: text("priority").notNull().default("medium"), // 'low', 'medium', 'high', 'urgent'
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    order: integer("order").notNull().default(0),
    whatsappSent: boolean("whatsapp_sent").notNull().default(false),
    googleCalendarEventId: text("google_calendar_event_id"),
    // ── Alt 04 (tarefa com hora/lembrete/recorrência) ──────────────────────
    // dueDate (DATE acima) é mantido como projeção (UI antiga, Calendar, cron
    // legado). dueAt é a fonte da HORA exata. reminderAt = quando notificar.
    dueAt: timestamp("due_at", { withTimezone: true }),
    reminderAt: timestamp("reminder_at", { withTimezone: true }),
    recurrenceEveryDays: integer("recurrence_every_days"), // null = não recorrente
    recurrenceUntil: timestamp("recurrence_until", { withTimezone: true }),
    // Quem gerou a tarefa (automação stage_enter → step create_task). Sem
    // .references() de propósito: evita ciclo de import kanban↔automations; a
    // FK é criada pelo scripts/apply-stage-task-dedup-index.ts.
    sourceAutomationId: uuid("source_automation_id"),
    sourceStepId: uuid("source_step_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_kanban_assigned").on(table.assignedTo),
    index("idx_kanban_due_date").on(table.dueDate),
    index("idx_kanban_column").on(table.columnId),
    index("idx_kanban_reminder_at").on(table.reminderAt),
    // Índices PARCIAIS (só tarefas abertas) pros hot paths do Alt 04:
    // - dedup do create_task (runner): (source_automation_id, lead_id)
    // - lembrete por reminderAt e legado por dueDate (cron de 1 min)
    // Aplicados também por script (apply-review-fix-indexes.ts) pra DB existente.
    index("idx_kanban_source_auto")
      .on(table.sourceAutomationId, table.leadId)
      .where(sql`is_completed = false`),
    index("idx_kanban_reminder_open")
      .on(table.reminderAt)
      .where(sql`is_completed = false AND reminder_at IS NOT NULL`),
    index("idx_kanban_due_open")
      .on(table.dueDate)
      .where(sql`is_completed = false AND reminder_at IS NULL AND due_date IS NOT NULL`),
  ]
);

// ============================================
// Relations
// ============================================

export const kanbanColumnRelations = relations(kanbanColumn, ({ one, many }) => ({
  tenant: one(tenant, { fields: [kanbanColumn.tenantId], references: [tenant.id] }),
  tasks: many(kanbanTask),
}));

export const kanbanTaskRelations = relations(kanbanTask, ({ one }) => ({
  column: one(kanbanColumn, {
    fields: [kanbanTask.columnId],
    references: [kanbanColumn.id],
  }),
  lead: one(lead, {
    fields: [kanbanTask.leadId],
    references: [lead.id],
  }),
  assignee: one(user, {
    fields: [kanbanTask.assignedTo],
    references: [user.id],
    relationName: "assignedTasks",
  }),
  creator: one(user, {
    fields: [kanbanTask.createdBy],
    references: [user.id],
    relationName: "createdTasks",
  }),
}));
