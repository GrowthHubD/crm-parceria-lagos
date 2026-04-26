import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { tenant } from "@/lib/db/schema/tenants";
import type { UserRole } from "@/types";
import { TenantsManager } from "@/components/admin/tenants-manager";

export const metadata: Metadata = { title: "Gestão de Tenants" };

export default async function TenantsPage() {
  let tenantCtx;
  try {
    tenantCtx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  const hasPermission = await checkPermission(
    tenantCtx.userId,
    tenantCtx.role as UserRole,
    "tenants",
    "view",
    tenantCtx
  );
  if (!hasPermission) redirect("/");

  const tenants = await db.select().from(tenant);

  return (
    <TenantsManager
      initialTenants={tenants.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }))}
    />
  );
}
