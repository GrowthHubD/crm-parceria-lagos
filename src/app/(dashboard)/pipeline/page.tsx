import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/permissions";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { pipeline, pipelineStage, lead, leadTag, leadTagAssignment } from "@/lib/db/schema/pipeline";
import { crmConversation } from "@/lib/db/schema/crm";
import { user } from "@/lib/db/schema/users";
import { eq, asc, desc, and } from "drizzle-orm";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import type { UserRole } from "@/types";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  let tenantCtx;
  try {
    tenantCtx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  const userRole = tenantCtx.role as UserRole;

  const [canView, canEdit, canDelete] = await Promise.all([
    checkPermission(tenantCtx.userId, userRole, "pipeline", "view", tenantCtx),
    checkPermission(tenantCtx.userId, userRole, "pipeline", "edit", tenantCtx),
    checkPermission(tenantCtx.userId, userRole, "pipeline", "delete", tenantCtx),
  ]);

  if (!canView) redirect("/");

  // Buscar funis do tenant
  const funnels = await db
    .select({ id: pipeline.id, name: pipeline.name, isDefault: pipeline.isDefault })
    .from(pipeline)
    .where(eq(pipeline.tenantId, tenantCtx.tenantId))
    .orderBy(asc(pipeline.createdAt));

  const defaultPipeline = funnels.find((f) => f.isDefault) ?? funnels[0];
  const activePipelineId = defaultPipeline?.id;

  // Buscar stages do pipeline ativo
  const stageFilter = activePipelineId
    ? and(eq(pipelineStage.tenantId, tenantCtx.tenantId), eq(pipelineStage.pipelineId, activePipelineId))
    : eq(pipelineStage.tenantId, tenantCtx.tenantId);

  const [stages, leads, tags, activeUsers, allTags] = await Promise.all([
    db.select().from(pipelineStage).where(stageFilter).orderBy(asc(pipelineStage.order)),
    db
      .select({
        id: lead.id,
        name: lead.name,
        companyName: lead.companyName,
        email: lead.email,
        phone: lead.phone,
        stageId: lead.stageId,
        source: lead.source,
        estimatedValue: lead.estimatedValue,
        notes: lead.notes,
        assignedTo: lead.assignedTo,
        assigneeName: user.name,
        updatedAt: lead.updatedAt,
        // Para filtro compartilhado: classificação vem da conversa vinculada.
        crmConversationId: lead.crmConversationId,
        classification: crmConversation.classification,
      })
      .from(lead)
      .where(eq(lead.tenantId, tenantCtx.tenantId))
      .leftJoin(user, eq(lead.assignedTo, user.id))
      .leftJoin(crmConversation, eq(lead.crmConversationId, crmConversation.id))
      .orderBy(desc(lead.createdAt)),
    db
      .select({
        leadId: leadTagAssignment.leadId,
        tagId: leadTagAssignment.tagId,
        tagName: leadTag.name,
        tagColor: leadTag.color,
      })
      .from(leadTagAssignment)
      // innerJoin com filtro tenantId no leadTag — só assignments cuja tag pertence ao tenant.
      .innerJoin(leadTag, and(eq(leadTagAssignment.tagId, leadTag.id), eq(leadTag.tenantId, tenantCtx.tenantId))),
    db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.isActive, true)),
    db.select().from(leadTag).where(eq(leadTag.tenantId, tenantCtx.tenantId)).orderBy(asc(leadTag.name)),
  ]);

  // Attach tags to leads
  const leadsWithTags = leads.map((l) => ({
    ...l,
    estimatedValue: l.estimatedValue ? String(l.estimatedValue) : null,
    updatedAt: l.updatedAt.toISOString(),
    tags: tags
      .filter((t) => t.leadId === l.id)
      .map((t) => ({ id: t.tagId, name: t.tagName, color: t.tagColor })),
  }));

  return (
    <KanbanBoard
      initialStages={stages}
      initialLeads={leadsWithTags}
      initialTags={allTags}
      users={activeUsers}
      currentUserId={tenantCtx.userId}
      funnels={funnels}
      activePipelineId={activePipelineId ?? ""}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
