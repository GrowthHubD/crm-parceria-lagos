import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { tenant } from "@/lib/db/schema/tenants";
import { whatsappNumber } from "@/lib/db/schema/crm";
import { eq, desc } from "drizzle-orm";
import { PartnerClientsManager } from "@/components/partner/clients-manager";

export const metadata: Metadata = { title: "Meus Clientes" };

export default async function PartnerPage() {
  let ctx;
  try {
    ctx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  if (ctx.role !== "partner_admin" && ctx.role !== "superadmin") {
    redirect("/");
  }

  // Lista clientes do parceiro (ou todos, se superadmin)
  const whereClause =
    ctx.role === "superadmin" ? undefined : eq(tenant.partnerId, ctx.tenantId);

  const baseQuery = db
    .select({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      billingStatus: tenant.billingStatus,
      billingEmail: tenant.billingEmail,
      createdAt: tenant.createdAt,
      whatsappActive: whatsappNumber.isActive,
      whatsappPhone: whatsappNumber.phoneNumber,
    })
    .from(tenant)
    .leftJoin(whatsappNumber, eq(whatsappNumber.tenantId, tenant.id))
    .orderBy(desc(tenant.createdAt));

  const clients = whereClause
    ? await baseQuery.where(whereClause)
    : await baseQuery;

  const serialized = clients.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Meus Clientes</h1>
        <p className="text-muted mt-1">
          Gerencie os clientes que você revende · {serialized.length} ativo{serialized.length !== 1 ? "s" : ""}
        </p>
      </div>

      <PartnerClientsManager initialClients={serialized} />
    </div>
  );
}
