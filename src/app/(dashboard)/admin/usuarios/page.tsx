import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { user, modulePermission } from "@/lib/db/schema/users";
import { asc } from "drizzle-orm";
import { UsersAdmin } from "@/components/admin/users-admin";
import type { UserRole } from "@/types";

export const metadata: Metadata = { title: "Admin — Usuários" };

export default async function AdminUsuariosPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;
  const canView = await checkPermission(session.user.id, userRole, "admin", "view");
  if (!canView) redirect("/");

  const [users, permissions] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        jobTitle: user.jobTitle,
        phone: user.phone,
        isActive: user.isActive,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(asc(user.name)),
    db.select().from(modulePermission),
  ]);

  const serializedUsers = users.map((u) => ({
    ...u,
    jobTitle: u.jobTitle ?? null,
    phone: u.phone ?? null,
    createdAt: u.createdAt.toISOString(),
  }));

  const serializedPermissions = permissions.map((p) => ({
    id: p.id,
    userId: p.userId,
    module: p.module,
    canView: p.canView,
    canEdit: p.canEdit,
    canDelete: p.canDelete,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Administração</h1>
        <p className="text-muted mt-1">Usuários e permissões do sistema</p>
      </div>

      <UsersAdmin
        initialUsers={serializedUsers}
        initialPermissions={serializedPermissions}
        currentUserId={session.user.id}
      />
    </div>
  );
}
