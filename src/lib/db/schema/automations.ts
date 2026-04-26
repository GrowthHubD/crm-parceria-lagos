import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenant } from "./tenants";
import { lead } from "./pipeline";

// ============================================
// AUTOMATIONS (sequências de follow-up)
// ============================================

export const automation = pgTable("automation", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  // triggers: 'first_message' | 'lead_inactive' | 'stage_enter' | 'tag_added'
  //         | 'manual' | 'manual_broadcast' | 'scheduled_once' | 'scheduled_recurring'
  triggerType: text("trigger_type").notNull(),
  // Config varia por trigger:
  //  - lead_inactive: { inactiveDays: 3 }
  //  - scheduled_once: { runAt: "2026-04-25T14:00:00Z" }
  //  - scheduled_recurring: { frequency: "daily"|"weekly"|"monthly", hour, minute, weekday?, day? }
  //  - stage_enter: { stageId }
  //  - tag_added: { tagId }
  triggerConfig: jsonb("trigger_config"),
  // Filtro de leads (audiência) — usado por scheduled_* e manual_broadcast
  // { pipelineId?, stageIds?[], tagIds?[], createdAfter?, createdBefore?,
  //   inactiveMinDays?, includeUnread?, includeConversations?: boolean }
  audienceFilter: jsonb("audience_filter"),
  // Quando a automação rodou pela última vez (usado pra evitar re-rodar recorrentes no mesmo slot)
  lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  // Quando true, só é visível pro scheduler rodando em AUTOMATION_DRY_RUN=true.
  // Processos de produção (dev server ticker) ignoram essa automação — isolam
  // testes E2E de disparos reais. Default false (produção normal).
  dryRun: boolean("dry_run").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const automationStep = pgTable(
  "automation_step",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    type: text("type").notNull(), // 'send_whatsapp' | 'wait' | 'send_email'
    config: jsonb("config").notNull(), // ex: { message: "Olá {{nome}}", delayMinutes: 60 }
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_automation_step_automation").on(table.automationId),
  ]
);

// Histórico de versões de cada step — criado automaticamente em toda edição
export const automationStepVersion = pgTable(
  "automation_step_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // stepId pode ficar null se o step for deletado (permite histórico sobreviver)
    stepId: uuid("step_id").references(() => automationStep.id, { onDelete: "set null" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    config: jsonb("config").notNull(), // snapshot do config antigo
    stepType: text("step_type").notNull(),
    note: text("note"), // opcional: descrição da mudança
    createdBy: text("created_by"), // userId que salvou
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_step_version_automation").on(table.automationId, table.createdAt),
    index("idx_step_version_step").on(table.stepId),
  ]
);

export const automationLog = pgTable(
  "automation_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => lead.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references(() => automationStep.id, { onDelete: "set null" }),
    // Denormalizado de automation.triggerType pra permitir partial unique index
    // (uq_autolog_welcome: 1 log por (automation, lead) quando trigger_type='first_message').
    triggerType: text("trigger_type"),
    status: text("status").notNull().default("pending"), // 'pending' | 'sent' | 'failed' | 'skipped'
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    error: text("error"),
    // Quando true, consumidor (runner) apenas simula o envio (grava crm_message
    // + updates de timestamp mas SEM chamar WhatsApp). Inserido por processos em
    // AUTOMATION_DRY_RUN=true pra isolar logs de teste de envios reais.
    dryRun: boolean("dry_run").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_automation_log_status").on(table.status, table.scheduledAt),
    index("idx_automation_log_automation").on(table.automationId),
  ]
);

// ============================================
// Relations
// ============================================

export const automationRelations = relations(automation, ({ one, many }) => ({
  tenant: one(tenant, { fields: [automation.tenantId], references: [tenant.id] }),
  steps: many(automationStep),
  logs: many(automationLog),
}));

export const automationStepRelations = relations(automationStep, ({ one }) => ({
  automation: one(automation, {
    fields: [automationStep.automationId],
    references: [automation.id],
  }),
}));

export const automationLogRelations = relations(automationLog, ({ one }) => ({
  automation: one(automation, {
    fields: [automationLog.automationId],
    references: [automation.id],
  }),
  lead: one(lead, {
    fields: [automationLog.leadId],
    references: [lead.id],
  }),
  step: one(automationStep, {
    fields: [automationLog.stepId],
    references: [automationStep.id],
  }),
}));
