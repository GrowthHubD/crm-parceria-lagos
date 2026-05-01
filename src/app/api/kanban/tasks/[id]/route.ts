import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { kanbanTask, kanbanColumn } from "@/lib/db/schema/kanban";
import { userGoogleIntegration } from "@/lib/db/schema/users";
import { and, eq } from "drizzle-orm";
import { updateCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar";
import type { UserRole } from "@/types";

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  columnId: z.string().uuid().optional(),
  assignedTo: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  isCompleted: z.boolean().optional(),
  order: z.number().int().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers).catch(() => null);
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const userRole = ctx.role as UserRole;
    const canEdit = await checkPermission(ctx.userId, userRole, "kanban", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    // Fetch existing task — exige tenant match pra evitar cross-tenant edit
    const [existing] = await db
      .select()
      .from(kanbanTask)
      .where(and(eq(kanbanTask.id, id), eq(kanbanTask.tenantId, ctx.tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });

    const d = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (d.title !== undefined) updates.title = d.title;
    if (d.description !== undefined) updates.description = d.description;
    if (d.columnId !== undefined) {
      // Coluna destino também tem que pertencer ao tenant
      const [col] = await db
        .select({ id: kanbanColumn.id })
        .from(kanbanColumn)
        .where(and(eq(kanbanColumn.id, d.columnId), eq(kanbanColumn.tenantId, ctx.tenantId)))
        .limit(1);
      if (!col) return NextResponse.json({ error: "Coluna destino inválida" }, { status: 400 });
      updates.columnId = d.columnId;
    }
    if (d.assignedTo !== undefined) updates.assignedTo = d.assignedTo;
    if (d.dueDate !== undefined) updates.dueDate = d.dueDate;
    if (d.priority !== undefined) updates.priority = d.priority;
    if (d.order !== undefined) updates.order = d.order;
    if (d.isCompleted !== undefined) {
      updates.isCompleted = d.isCompleted;
      updates.completedAt = d.isCompleted ? new Date() : null;
    }

    const [updated] = await db
      .update(kanbanTask)
      .set(updates)
      .where(and(eq(kanbanTask.id, id), eq(kanbanTask.tenantId, ctx.tenantId)))
      .returning();

    // Sync to Google Calendar (best-effort, only when title/dueDate/priority changed)
    const calendarRelevant = d.title !== undefined || d.dueDate !== undefined || d.priority !== undefined || d.description !== undefined;
    if (calendarRelevant && updated.googleCalendarEventId && updated.dueDate) {
      const assigneeId = updated.assignedTo;
      const [integration] = await db
        .select({ googleCalendarId: userGoogleIntegration.googleCalendarId })
        .from(userGoogleIntegration)
        .where(eq(userGoogleIntegration.userId, assigneeId))
        .limit(1);

      if (integration) {
        await updateCalendarEvent(assigneeId, integration.googleCalendarId, updated.googleCalendarEventId, {
          title: updated.title,
          description: updated.description,
          dueDate: updated.dueDate,
          priority: updated.priority,
        });
      }
    }

    return NextResponse.json({ task: updated });
  } catch {
    console.error("[KANBAN] PATCH task failed:", { operation: "update" });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers).catch(() => null);
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const userRole = ctx.role as UserRole;
    const canDelete = await checkPermission(ctx.userId, userRole, "kanban", "delete", ctx);
    if (!canDelete) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    // Fetch before delete (escopado pelo tenant) for Calendar cleanup
    const [existing] = await db
      .select()
      .from(kanbanTask)
      .where(and(eq(kanbanTask.id, id), eq(kanbanTask.tenantId, ctx.tenantId)))
      .limit(1);

    const [deleted] = await db
      .delete(kanbanTask)
      .where(and(eq(kanbanTask.id, id), eq(kanbanTask.tenantId, ctx.tenantId)))
      .returning({ id: kanbanTask.id });

    if (!deleted) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });

    // Clean up Calendar event
    if (existing?.googleCalendarEventId) {
      const [integration] = await db
        .select({ googleCalendarId: userGoogleIntegration.googleCalendarId })
        .from(userGoogleIntegration)
        .where(eq(userGoogleIntegration.userId, existing.assignedTo))
        .limit(1);

      if (integration) {
        await deleteCalendarEvent(existing.assignedTo, integration.googleCalendarId, existing.googleCalendarEventId);
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    console.error("[KANBAN] DELETE task failed:", { operation: "delete" });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
