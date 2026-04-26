import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  integer,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ============================================
// TENANT
// ============================================
// Relations definidas em users.ts para evitar circular import

export const tenant = pgTable("tenant", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isPlatformOwner: boolean("is_platform_owner").notNull().default(false),
  status: text("status").notNull().default("active"), // 'active' | 'suspended' | 'inactive'
  uazapiInstanceId: text("uazapi_instance_id"),

  // ── SaaS 3-níveis ──────────────────────────────────────────────────
  /** Tenant do parceiro que criou este cliente (null para GH e parceiros). */
  partnerId: uuid("partner_id").references((): AnyPgColumn => tenant.id, { onDelete: "set null" }),
  /** Identifica tenants que são parceiros (revendem o sistema). */
  isPartner: boolean("is_partner").notNull().default(false),

  // ── Billing / plano ────────────────────────────────────────────────
  plan: text("plan").notNull().default("pro"), // 'free' | 'pro' | 'enterprise'
  billingEmail: text("billing_email"),
  billingStatus: text("billing_status").notNull().default("active"), // 'active' | 'overdue' | 'canceled'

  // ── Quotas ──────────────────────────────────────────────────────────
  maxWhatsappNumbers: integer("max_whatsapp_numbers").notNull().default(1),
  maxOperators: integer("max_operators").notNull().default(3),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
