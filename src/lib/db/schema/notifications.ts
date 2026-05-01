import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./users";
import { tenant } from "./tenants";
import { kanbanTask } from "./kanban";

// ============================================
// NOTIFICATIONS
// ============================================

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: text("type").notNull(), // 'contract_expiring', 'task_due', 'new_lead', 'payment_overdue', 'system'
    module: text("module"), // Module of origin
    link: text("link"), // Internal URL for navigation
    isRead: boolean("is_read").notNull().default(false),
    // Quando type='task_due', referencia a tarefa que disparou. Permite dedup
    // (não criar 2x lembrete da mesma task) e cleanup (delete cascata se
    // a task for removida).
    taskId: uuid("task_id").references(() => kanbanTask.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_notification_user").on(table.userId, table.isRead, table.createdAt),
    // Unique parcial: cada par (userId, taskId, type) só pode existir 1x
    // pra type='task_due'. Postgres permite múltiplos NULLs por default em
    // unique, então notificações sem taskId não colidem entre si.
    unique("uq_notification_task_user").on(table.userId, table.taskId, table.type),
  ]
);

// ============================================
// Relations
// ============================================

export const notificationRelations = relations(notification, ({ one }) => ({
  tenant: one(tenant, { fields: [notification.tenantId], references: [tenant.id] }),
  user: one(user, {
    fields: [notification.userId],
    references: [user.id],
  }),
}));
