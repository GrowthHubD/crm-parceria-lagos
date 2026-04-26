import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { client } from "@/lib/db/schema/clients";
import { desc } from "drizzle-orm";
import { ClientList } from "@/components/clientes/client-list";
import type { UserRole } from "@/types";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;

  const [canView, canEdit, canDelete] = await Promise.all([
    checkPermission(session.user.id, userRole, "clients", "view"),
    checkPermission(session.user.id, userRole, "clients", "edit"),
    checkPermission(session.user.id, userRole, "clients", "delete"),
  ]);

  if (!canView) redirect("/");

  const clients = await db
    .select({
      id: client.id,
      companyName: client.companyName,
      cnpj: client.cnpj,
      responsibleName: client.responsibleName,
      email: client.email,
      phone: client.phone,
      status: client.status,
      notes: client.notes,
      createdAt: client.createdAt,
    })
    .from(client)
    .orderBy(desc(client.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Clientes</h1>
        <p className="text-muted mt-1">Gestão de clientes ativos da Growth Hub</p>
      </div>

      <ClientList
        initialClients={clients.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
        }))}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
