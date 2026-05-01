import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { kanbanColumn, kanbanTask } from "@/lib/db/schema/kanban";
import { lead, pipelineStage } from "@/lib/db/schema/pipeline";
import { user } from "@/lib/db/schema/users";
import { eq, asc, desc, and } from "drizzle-orm";
import type { UserRole } from "@/types";
import { TasksBoard } from "@/components/tasks/tasks-board";

export const metadata: Metadata = { title: "Tarefas" };

export default async function TasksPage() {
  let tenantCtx;
  try {
    tenantCtx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  const userRole = tenantCtx.role as UserRole;
  const [canView, canEdit, canDelete] = await Promise.all([
    checkPermission(tenantCtx.userId, userRole, "tasks", "view", tenantCtx),
    checkPermission(tenantCtx.userId, userRole, "tasks", "edit", tenantCtx),
    checkPermission(tenantCtx.userId, userRole, "tasks", "delete", tenantCtx),
  ]);
  if (!canView) redirect("/");

  const isOperational = userRole === "operational" || userRole === "operator";

  const [columns, tasks, activeUsers, tenantLeads] = await Promise.all([
    db.select().from(kanbanColumn)
      .where(eq(kanbanColumn.tenantId, tenantCtx.tenantId))
      .orderBy(asc(kanbanColumn.order)),

    db.select({
      id: kanbanTask.id,
      title: kanbanTask.title,
      description: kanbanTask.description,
      columnId: kanbanTask.columnId,
      assignedTo: kanbanTask.assignedTo,
      leadId: kanbanTask.leadId,
      dueDate: kanbanTask.dueDate,
      priority: kanbanTask.priority,
      isCompleted: kanbanTask.isCompleted,
      completedAt: kanbanTask.completedAt,
      order: kanbanTask.order,
      createdBy: kanbanTask.createdBy,
      createdAt: kanbanTask.createdAt,
      assigneeName: user.name,
      leadName: lead.name,
    })
      .from(kanbanTask)
      .leftJoin(user, eq(kanbanTask.assignedTo, user.id))
      .leftJoin(lead, eq(kanbanTask.leadId, lead.id))
      .where(
        and(
          eq(kanbanTask.tenantId, tenantCtx.tenantId),
          isOperational ? eq(kanbanTask.assignedTo, tenantCtx.userId) : undefined
        )
      )
      .orderBy(asc(kanbanTask.order), desc(kanbanTask.createdAt)),

    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.isActive, true)),

    db.select({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      stageName: pipelineStage.name,
      stageColor: pipelineStage.color,
    })
      .from(lead)
      .leftJoin(pipelineStage, eq(lead.stageId, pipelineStage.id))
      .where(and(eq(lead.tenantId, tenantCtx.tenantId), eq(lead.isConverted, false)))
      .orderBy(desc(lead.createdAt)),
  ]);

  // Serializa Date → ISO string pra cruzar boundary server→client
  const tasksSerialized = tasks.map((t) => ({
    ...t,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : (t.createdAt as unknown as string),
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : (t.updatedAt as unknown as string),
    completedAt: t.completedAt instanceof Date ? t.completedAt.toISOString() : (t.completedAt as unknown as string | null),
    dueDate: t.dueDate instanceof Date ? t.dueDate.toISOString() : (t.dueDate as unknown as string | null),
  }));

  return (
    <TasksBoard
      initialColumns={columns}
      initialTasks={tasksSerialized}
      users={activeUsers}
      leads={tenantLeads}
      currentUserId={tenantCtx.userId}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
