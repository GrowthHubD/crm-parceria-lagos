import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation, automationStep, automationLog, automationStepVersion } from "@/lib/db/schema/automations";
import { lead } from "@/lib/db/schema/pipeline";
import { eq, and, asc, desc } from "drizzle-orm";
import type { UserRole } from "@/types";

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  triggerType: z
    .enum([
      "stage_enter",
      "tag_added",
      "manual",
      "manual_broadcast",
      "first_message",
      "lead_inactive",
      "scheduled_once",
      "scheduled_recurring",
    ])
    .optional(),
  triggerConfig: z.record(z.unknown()).optional().nullable(),
  audienceFilter: z.record(z.unknown()).optional().nullable(),
  isActive: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        type: z.enum(["send_whatsapp", "wait", "send_email"]),
        config: z.record(z.unknown()),
      })
    )
    .optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canView = await checkPermission(ctx.userId, ctx.role as UserRole, "automations", "view", ctx);
    if (!canView) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const [auto] = await db
      .select()
      .from(automation)
      .where(and(eq(automation.id, id), eq(automation.tenantId, ctx.tenantId)))
      .limit(1);

    if (!auto) return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });

    const steps = await db
      .select()
      .from(automationStep)
      .where(eq(automationStep.automationId, id))
      .orderBy(asc(automationStep.order));

    const logs = await db
      .select({
        id: automationLog.id,
        leadId: automationLog.leadId,
        leadName: lead.name,
        stepId: automationLog.stepId,
        status: automationLog.status,
        scheduledAt: automationLog.scheduledAt,
        executedAt: automationLog.executedAt,
        error: automationLog.error,
      })
      .from(automationLog)
      .leftJoin(lead, eq(automationLog.leadId, lead.id))
      .where(eq(automationLog.automationId, id))
      .orderBy(desc(automationLog.createdAt))
      .limit(50);

    return NextResponse.json({ automation: auto, steps, logs });
  } catch {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "automations", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const d = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (d.name !== undefined) updates.name = d.name;
    if (d.description !== undefined) updates.description = d.description;
    if (d.triggerType !== undefined) updates.triggerType = d.triggerType;
    if (d.triggerConfig !== undefined) updates.triggerConfig = d.triggerConfig;
    if (d.audienceFilter !== undefined) updates.audienceFilter = d.audienceFilter;
    if (d.isActive !== undefined) updates.isActive = d.isActive;

    const [updated] = await db
      .update(automation)
      .set(updates)
      .where(and(eq(automation.id, id), eq(automation.tenantId, ctx.tenantId)))
      .returning();

    if (!updated) return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });

    // Se steps foram fornecidos, substituir — mas antes salva versão dos steps antigos
    if (d.steps) {
      const oldSteps = await db
        .select()
        .from(automationStep)
        .where(eq(automationStep.automationId, id));

      // Snapshot cada step antigo em automation_step_version (pra histórico/restore)
      for (const old of oldSteps) {
        await db.insert(automationStepVersion).values({
          stepId: old.id,
          automationId: id,
          config: old.config,
          stepType: old.type,
          createdBy: ctx.userId,
        });
      }

      await db.delete(automationStep).where(eq(automationStep.automationId, id));
      for (let i = 0; i < d.steps.length; i++) {
        await db.insert(automationStep).values({
          automationId: id,
          order: i + 1,
          type: d.steps[i].type,
          config: d.steps[i].config,
        });
      }
    }

    return NextResponse.json({ automation: updated });
  } catch {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "automations", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const [deleted] = await db
      .delete(automation)
      .where(and(eq(automation.id, id), eq(automation.tenantId, ctx.tenantId)))
      .returning({ id: automation.id });

    if (!deleted) return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
