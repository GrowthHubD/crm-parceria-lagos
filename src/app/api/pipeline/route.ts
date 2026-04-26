import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { pipeline, pipelineStage, lead, leadTag, leadTagAssignment } from "@/lib/db/schema/pipeline";
import { crmConversation, crmMessage } from "@/lib/db/schema/crm";
import { user } from "@/lib/db/schema/users";
import { eq, asc, desc, and } from "drizzle-orm";
import { getTenantContext } from "@/lib/tenant";
import { getNextFollowUpBatch } from "@/lib/automations/chain-preview";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantContext(request.headers);
    const canView = await checkPermission(ctx.userId, ctx.role as UserRole, "pipeline", "view", ctx);
    if (!canView) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    // Filtrar por pipelineId se fornecido, senão usar o default do tenant
    let pipelineId = request.nextUrl.searchParams.get("pipelineId");
    if (!pipelineId) {
      const [defaultPipeline] = await db
        .select({ id: pipeline.id })
        .from(pipeline)
        .where(and(eq(pipeline.tenantId, ctx.tenantId), eq(pipeline.isDefault, true)))
        .limit(1);
      pipelineId = defaultPipeline?.id ?? null;
    }

    // Buscar funis do tenant para o seletor
    const funnels = await db
      .select({ id: pipeline.id, name: pipeline.name, isDefault: pipeline.isDefault })
      .from(pipeline)
      .where(eq(pipeline.tenantId, ctx.tenantId))
      .orderBy(asc(pipeline.createdAt));

    const stageFilter = pipelineId
      ? and(eq(pipelineStage.tenantId, ctx.tenantId), eq(pipelineStage.pipelineId, pipelineId))
      : eq(pipelineStage.tenantId, ctx.tenantId);

    const [stages, leads, tags, allUsers] = await Promise.all([
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
          createdAt: lead.createdAt,
          updatedAt: lead.updatedAt,
          assigneeName: user.name,
          crmConversationId: lead.crmConversationId,
          contactProfilePicUrl: crmConversation.contactProfilePicUrl,
          contactPushName: crmConversation.contactPushName,
          lastMessageAt: crmConversation.lastMessageAt,
        })
        .from(lead)
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
        .innerJoin(leadTag, eq(leadTagAssignment.tagId, leadTag.id)),
      db.select({ id: user.id, name: user.name }).from(user).where(eq(user.isActive, true)),
    ]);

    // Batch de próximos follow-ups (1 round-trip pra N leads)
    const nextFollowUps = await getNextFollowUpBatch(
      ctx.tenantId,
      leads.map((l) => l.id)
    );

    // Preview da última mensagem por conversa — 1 query LIMIT 1 por conv
    // em paralelo. Mais rápido que buscar TODAS as msgs dos convs.
    const convIds = leads.map((l) => l.crmConversationId).filter(Boolean) as string[];
    const lastMsgByConv = new Map<string, { content: string | null; mediaType: string | null; direction: string; timestamp: Date }>();
    if (convIds.length > 0) {
      await Promise.all(
        convIds.map(async (convId) => {
          const [m] = await db
            .select({
              content: crmMessage.content,
              mediaType: crmMessage.mediaType,
              direction: crmMessage.direction,
              timestamp: crmMessage.timestamp,
            })
            .from(crmMessage)
            .where(eq(crmMessage.conversationId, convId))
            .orderBy(desc(crmMessage.timestamp))
            .limit(1);
          if (m) lastMsgByConv.set(convId, m);
        })
      );
    }

    // Attach tags + nextFollowUp + lastMessage to leads
    const leadsWithTags = leads.map((l) => {
      const last = l.crmConversationId ? lastMsgByConv.get(l.crmConversationId) : undefined;
      return {
        ...l,
        tags: tags
          .filter((t) => t.leadId === l.id)
          .map((t) => ({ id: t.tagId, name: t.tagName, color: t.tagColor })),
        nextFollowUp: nextFollowUps.get(l.id) ?? null,
        lastMessage: last
          ? {
              preview: (() => {
                const mt = (last.mediaType ?? "").toLowerCase();
                if (mt === "audio" || mt === "ptt" || mt === "voice") return "🎤 Áudio";
                if (mt === "image" || mt === "sticker")
                  return last.content?.trim() ? `📷 ${last.content}` : "📷 Imagem";
                if (mt === "video")
                  return last.content?.trim() ? `🎥 ${last.content}` : "🎥 Vídeo";
                if (mt === "document")
                  return last.content?.trim() ? `📄 ${last.content}` : "📄 Documento";
                return last.content?.trim() || "Mensagem";
              })(),
              direction: last.direction,
              timestamp: last.timestamp,
            }
          : null,
      };
    });

    return NextResponse.json({
      stages,
      leads: leadsWithTags,
      users: allUsers,
      funnels,
      activePipelineId: pipelineId,
    });
  } catch (error) {
    console.error("[PIPELINE] GET failed:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
