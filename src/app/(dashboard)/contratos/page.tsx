import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { contract } from "@/lib/db/schema/contracts";
import { client } from "@/lib/db/schema/clients";
import { desc, eq } from "drizzle-orm";
import { ContractList } from "@/components/contratos/contract-list";
import type { UserRole } from "@/types";

export const metadata: Metadata = { title: "Contratos" };

export default async function ContratosPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;

  const [canView, canEdit, canDelete] = await Promise.all([
    checkPermission(session.user.id, userRole, "contracts", "view"),
    checkPermission(session.user.id, userRole, "contracts", "edit"),
    checkPermission(session.user.id, userRole, "contracts", "delete"),
  ]);

  if (!canView) redirect("/");

  const [contracts, clients] = await Promise.all([
    db.select().from(contract).orderBy(desc(contract.createdAt)),
    db
      .select({ id: client.id, companyName: client.companyName })
      .from(client)
      .where(eq(client.status, "active")),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Contratos</h1>
        <p className="text-muted mt-1">Gestão de contratos e receita recorrente</p>
      </div>

      <ContractList
        initialContracts={contracts.map((c) => ({
          id: c.id,
          clientId: c.clientId,
          companyName: c.companyName,
          monthlyValue: String(c.monthlyValue),
          implementationValue: c.implementationValue ? String(c.implementationValue) : null,
          type: c.type,
          startDate: c.startDate,
          endDate: c.endDate ?? null,
          paymentDay: c.paymentDay ?? null,
          status: c.status,
          driveFileId: c.driveFileId ?? null,
          notes: c.notes ?? null,
          createdAt: c.createdAt.toISOString(),
        }))}
        clients={clients}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
