// ============================================
// Global Types — Plataforma Growth Hub
// ============================================

// Roles legados AMS (mantidos para backward compat)
export type LegacyRole = "partner" | "manager" | "operational";

// Roles multi-tenant (SaaS 3-níveis)
// - superadmin: GH, vê/gerencia tudo
// - partner_admin: parceiro (revenda), gerencia seus clientes
// - admin: dono do cliente final
// - operator: atendente do cliente final
export type TenantRole = "superadmin" | "partner_admin" | "admin" | "operator";

export type UserRole = LegacyRole | TenantRole;

// UUID fixo do tenant Growth Hub (tenant 0 / is_platform_owner)
export const GH_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export type JobTitle =
  | "gestor_trafego"
  | "gestor_automacao"
  | "social_media"
  | "designer"
  | "copywriter"
  | "analista"
  | "diretor";

export type SystemModule =
  | "dashboard"
  | "pipeline"
  | "contracts"
  | "financial"
  | "crm"
  | "clients"
  | "sdr"
  | "kanban"
  | "blog"
  | "admin"
  | "agenda"
  | "configuracoes"
  | "automations"       // CRM Lagos: sequências de follow-up
  | "tasks"             // CRM Lagos: tarefas vinculadas a lead
  | "tenants"           // Superadmin: gestão de tenants
  | "partner_clients"   // partner_admin: lista + criação de clientes
  | "partner_metrics";  // partner_admin: métricas agregadas dos clientes

// Módulos exclusivos do tenant GH (is_platform_owner)
export const AMS_ONLY_MODULES: SystemModule[] = [
  "contracts",
  "financial",
  "clients",
  "sdr",
  "kanban",
  "blog",
];

// Módulos exclusivos do superadmin
export const SUPERADMIN_ONLY_MODULES: SystemModule[] = ["tenants"];

// Módulos exclusivos do partner_admin
export const PARTNER_ONLY_MODULES: SystemModule[] = ["partner_clients", "partner_metrics"];

export type PermissionAction = "view" | "edit" | "delete";

export type LeadSource = "sdr_bot" | "indicacao" | "inbound" | "outbound";

export type ConversationClassification =
  | "hot"
  | "warm"
  | "cold"
  | "active_client"
  | "new";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type TransactionType = "income" | "expense";

export type TransactionCategory =
  | "infraestrutura"
  | "interno"
  | "educacao"
  | "cliente"
  | "servico"
  | "outro";

export type TransactionStatus = "paid" | "pending" | "overdue";

export type ContractStatus = "active" | "expiring" | "inactive";

export type NotificationType =
  | "contract_expiring"
  | "task_due"
  | "new_lead"
  | "payment_overdue"
  | "system";

export type BlogPostType = "list" | "article" | "guide" | "study";

/**
 * Sidebar navigation item definition
 */
export interface NavItem {
  title: string;
  href: string;
  icon: string;
  module: SystemModule;
  badge?: number;
}

/**
 * Default module permissions by role
 */
export const DEFAULT_PERMISSIONS: Record<
  UserRole,
  { modules: SystemModule[]; canEdit: boolean; canDelete: boolean }
> = {
  // --- Roles legados AMS ---
  partner: {
    modules: [
      "dashboard",
      "pipeline",
      "contracts",
      "financial",
      "crm",
      "clients",
      "sdr",
      "kanban",
      "agenda",
      "blog",
      "admin",
      "configuracoes",
      "automations",
      "tasks",
      "partner_clients",
      "partner_metrics",
    ],
    canEdit: true,
    canDelete: true,
  },
  manager: {
    modules: [
      "dashboard",
      "pipeline",
      "contracts",
      "crm",
      "clients",
      "kanban",
      "agenda",
      "blog",
      "configuracoes",
      "automations",
      "tasks",
    ],
    canEdit: true,
    canDelete: false,
  },
  operational: {
    modules: ["kanban", "agenda", "blog", "configuracoes", "tasks"],
    canEdit: true,
    canDelete: false,
  },

  // --- Roles multi-tenant ---
  superadmin: {
    modules: [
      "dashboard",
      "pipeline",
      "contracts",
      "financial",
      "crm",
      "clients",
      "sdr",
      "kanban",
      "agenda",
      "blog",
      "admin",
      "configuracoes",
      "automations",
      "tasks",
      "tenants",
      "partner_clients",
      "partner_metrics",
    ],
    canEdit: true,
    canDelete: true,
  },
  admin: {
    modules: [
      "dashboard",
      "pipeline",
      "crm",
      "clients",
      "kanban",
      "agenda",
      "configuracoes",
      "automations",
      "tasks",
    ],
    canEdit: true,
    canDelete: false,
  },
  operator: {
    modules: ["dashboard", "pipeline", "crm", "kanban", "agenda", "tasks"],
    canEdit: true,
    canDelete: false,
  },

  // --- SaaS: parceiro revendedor ---
  partner_admin: {
    modules: [
      "dashboard",
      "partner_clients",
      "partner_metrics",
      "configuracoes",
    ],
    canEdit: true,
    canDelete: true,
  },
};
