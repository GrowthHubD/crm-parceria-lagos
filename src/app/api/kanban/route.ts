import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { kanbanColumn, kanbanTask } from "@/lib/db/schema/kanban";
import { user } from "@/lib/db/schema/users";
import { eq, asc, and, desc } from "drizzle-orm";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantContext(request.headers).catch(() => null);
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const userRole = ctx.role as UserRole;
    const canView = await checkPermission(ctx.userId, userRole, "kanban", "view", ctx);
    if (!canView) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const columns = await db
      .select()
      .from(kanbanColumn)
      .where(eq(kanbanColumn.tenantId, ctx.tenantId))
      .orderBy(asc(kanbanColumn.order));

    // Operational users only see their own tasks
    const isOperational = userRole === "operational" || userRole === "operator";

    // Filtro por leadId (opcional — usado ao visualizar tarefas de um lead)
    const leadIdParam = request.nextUrl.searchParams.get("leadId");

    const whereConditions = [eq(kanbanTask.tenantId, ctx.tenantId)];
    if (isOperational) whereConditions.push(eq(kanbanTask.assignedTo, ctx.userId));
    if (leadIdParam) whereConditions.push(eq(kanbanTask.leadId, leadIdParam));

    const tasks = await db
      .select({
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
        whatsappSent: kanbanTask.whatsappSent,
        createdBy: kanbanTask.createdBy,
        createdAt: kanbanTask.createdAt,
        assigneeName: user.name,
      })
      .from(kanbanTask)
      .leftJoin(user, eq(kanbanTask.assignedTo, user.id))
      .where(and(...whereConditions))
      .orderBy(asc(kanbanTask.order), desc(kanbanTask.createdAt));

    const allUsers = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.isActive, true));

    return NextResponse.json({ columns, tasks, users: allUsers });
  } catch {
    console.error("[KANBAN] GET failed:", { operation: "list" });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
