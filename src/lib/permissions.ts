import { db } from "./db";
import { modulePermission } from "./db/schema/users";
import { eq, and } from "drizzle-orm";
import type { SystemModule, PermissionAction, UserRole } from "@/types";
import { DEFAULT_PERMISSIONS, AMS_ONLY_MODULES, SUPERADMIN_ONLY_MODULES, PARTNER_ONLY_MODULES } from "@/types";
import type { TenantContext } from "./tenant";

/**
 * Check if a user has permission to perform an action on a module.
 * Superadmins and partners always have full access.
 * AMS-only modules require is_platform_owner = true.
 * Falls back to DEFAULT_PERMISSIONS for role-based access.
 */
export async function checkPermission(
  userId: string,
  userRole: UserRole,
  module: SystemModule,
  action: PermissionAction = "view",
  tenantCtx?: TenantContext
): Promise<boolean> {
  // Superadmin and partner always have full access
  if (userRole === "superadmin" || userRole === "partner") return true;

  // AMS-only modules: só para tenant GH (is_platform_owner)
  if (AMS_ONLY_MODULES.includes(module)) {
    if (!tenantCtx?.isPlatformOwner) return false;
  }

  // Superadmin-only modules: bloqueado para todos os outros roles
  if (SUPERADMIN_ONLY_MODULES.includes(module)) return false;

  // Partner-only modules: apenas partner_admin (ou superadmin acima)
  if (PARTNER_ONLY_MODULES.includes(module) && userRole !== "partner_admin") return false;

  // Check explicit permission in database
  const [permission] = await db
    .select()
    .from(modulePermission)
    .where(
      and(
        eq(modulePermission.userId, userId),
        eq(modulePermission.module, module)
      )
    )
    .limit(1);

  if (permission) {
    switch (action) {
      case "view":
        return permission.canView;
      case "edit":
        return permission.canEdit;
      case "delete":
        return permission.canDelete;
      default:
        return false;
    }
  }

  // Fall back to default permissions for the role
  const defaults = DEFAULT_PERMISSIONS[userRole];
  if (!defaults) return false;

  const hasModuleAccess = defaults.modules.includes(module);
  if (!hasModuleAccess) return false;

  switch (action) {
    case "view":
      return true;
    case "edit":
      return defaults.canEdit;
    case "delete":
      return defaults.canDelete;
    default:
      return false;
  }
}

/**
 * Get all accessible modules for a user, filtered by tenant context.
 */
export async function getUserModules(
  userId: string,
  userRole: UserRole,
  tenantCtx?: TenantContext
): Promise<SystemModule[]> {
  // Superadmin and partner get all modules
  if (userRole === "superadmin" || userRole === "partner") {
    const modules = DEFAULT_PERMISSIONS[userRole]?.modules ?? [];
    // Partner não tem módulo tenants — só superadmin
    if (userRole === "partner") return modules;
    return modules;
  }

  // Check for explicit permissions
  const permissions = await db
    .select()
    .from(modulePermission)
    .where(
      and(
        eq(modulePermission.userId, userId),
        eq(modulePermission.canView, true)
      )
    );

  let modules: SystemModule[] =
    permissions.length > 0
      ? (permissions.map((p) => p.module as SystemModule))
      : (DEFAULT_PERMISSIONS[userRole]?.modules ?? []);

  // Filtrar módulos AMS para tenants que não são GH
  if (!tenantCtx?.isPlatformOwner) {
    modules = modules.filter((m) => !AMS_ONLY_MODULES.includes(m));
  }

  // Superadmin já retornou acima; aqui só filtramos pros outros
  modules = modules.filter((m) => !SUPERADMIN_ONLY_MODULES.includes(m));

  // Filtrar módulos partner-only para quem não é partner_admin
  if (userRole !== "partner_admin") {
    modules = modules.filter((m) => !PARTNER_ONLY_MODULES.includes(m));
  }

  return modules;
}
