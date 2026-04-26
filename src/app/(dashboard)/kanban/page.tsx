import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { kanbanColumn, kanbanTask } from "@/lib/db/schema/kanban";
import { user } from "@/lib/db/schema/users";
import { eq, asc, and, desc } from "drizzle-orm";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import type { UserRole } from "@/types";

export const metadata: Metadata = { title: "Kanban" };

export default async function KanbanPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;

  const [canView, canEdit, canDelete] = await Promise.all([
    checkPermission(session.user.id, userRole, "kanban", "view"),
    checkPermission(session.user.id, userRole, "kanban", "edit"),
    checkPermission(session.user.id, userRole, "kanban", "delete"),
  ]);

  if (!canView) redirect("/");

  const isOperational = userRole === "operational";

  const [columns, tasks, activeUsers] = await Promise.all([
    db.select().from(kanbanColumn).orderBy(asc(kanbanColumn.order)),
    db
      .select({
        id: kanbanTask.id,
        title: kanbanTask.title,
        description: kanbanTask.description,
        columnId: kanbanTask.columnId,
        assignedTo: kanbanTask.assignedTo,
        dueDate: kanbanTask.dueDate,
        priority: kanbanTask.priority,
        isCompleted: kanbanTask.isCompleted,
        order: kanbanTask.order,
        assigneeName: user.name,
      })
      .from(kanbanTask)
      .leftJoin(user, eq(kanbanTask.assignedTo, user.id))
      .where(isOperational ? eq(kanbanTask.assignedTo, session.user.id) : undefined)
      .orderBy(asc(kanbanTask.order), desc(kanbanTask.createdAt)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.isActive, true)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Kanban</h1>
        <p className="text-muted mt-1">
          {isOperational ? "Suas tarefas" : "Gestão de tarefas da equipe"}
        </p>
      </div>

      <KanbanBoard
        initialColumns={columns}
        initialTasks={tasks}
        users={activeUsers}
        currentUserId={session.user.id}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
