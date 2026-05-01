import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/permissions";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { lead, leadTagAssignment, pipelineStage } from "@/lib/db/schema/pipeline";
import { tenant } from "@/lib/db/schema/tenants";
import { eq, and, desc, inArray, or } from "drizzle-orm";
import type { UserRole } from "@/types";

/**
 * Gera o preview textual da última mensagem da conversa.
 * Áudio/imagem/vídeo/documento ganham rótulo emoji (sem dependência da
 * `content`, que pra mídia geralmente é null ou caption).
 *
 * Aceita aliases (ptt/voice → audio; sticker → image) que podem estar
 * gravados em rows antigos ou que escapem da normalização do webhook.
 */
function buildPreview(content: string | null, mediaType: string | null): string {
  const mt = (mediaType ?? "").toLowerCase();
  if (mt === "audio" || mt === "ptt" || mt === "voice") return "🎤 Áudio";
  if (mt === "image" || mt === "sticker") return content?.trim() ? `📷 ${content}` : "📷 Imagem";
  if (mt === "video") return content?.trim() ? `🎥 ${content}` : "🎥 Vídeo";
  if (mt === "document") return content?.trim() ? `📄 ${content}` : "📄 Documento";
  return content?.trim() || "Mensagem";
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantContext(request.headers);
    const canView = await checkPermission(ctx.userId, ctx.role as UserRole, "crm", "view", ctx);
    if (!canView) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const classification = searchParams.get("classification");
    const numberId = searchParams.get("numberId");
    const tagId = searchParams.get("tagId");
    const stageId = searchParams.get("stageId");
    const pipelineId = searchParams.get("pipelineId");
    const tenantFilter = searchParams.get("tenantId");

    // ── Tenants visíveis para este user (mesma regra do SSR em /crm/page.tsx)
    const visibleTenants = await (async () => {
      if (ctx.isPlatformOwner) {
        return db
          .select({ id: tenant.id, name: tenant.name })
          .from(tenant)
          .where(eq(tenant.status, "active"));
      }
      if (ctx.role === "superadmin" || ctx.role === "admin") {
        return db
          .select({ id: tenant.id, name: tenant.name })
          .from(tenant)
          .where(or(eq(tenant.id, ctx.tenantId), eq(tenant.partnerId, ctx.tenantId)));
      }
      return db
        .select({ id: tenant.id, name: tenant.name })
        .from(tenant)
        .where(eq(tenant.id, ctx.tenantId));
    })();
    const visibleTenantIds = visibleTenants.map((t) => t.id);
    const tenantNameById = new Map(visibleTenants.map((t) => [t.id, t.name]));

    // Filtro explícito por tenant (dropdown da inbox) só vale dentro do set visível
    const effectiveTenantIds =
      tenantFilter && visibleTenantIds.includes(tenantFilter)
        ? [tenantFilter]
        : visibleTenantIds;

    // ── Resolve conversationId set restritivo via JOIN com lead quando o
    //    filtro é por tag/stage/pipeline (cross-domain pra CRM). Fazemos isso
    //    em uma sub-query lookup pra não bagunçar a query principal.
    let restrictToConvIds: string[] | null = null;

    if (tagId || stageId || pipelineId) {
      // Buscar leads dos tenants visíveis que satisfaçam os filtros, e pegar seus crmConversationId
      const conditions = [inArray(lead.tenantId, effectiveTenantIds)];
      if (stageId) conditions.push(eq(lead.stageId, stageId));

      // pipelineId → restringe leads cujo stage pertença a esse pipeline
      if (pipelineId) {
        const stageRows = await db
          .select({ id: pipelineStage.id })
          .from(pipelineStage)
          .where(
            and(
              inArray(pipelineStage.tenantId, effectiveTenantIds),
              eq(pipelineStage.pipelineId, pipelineId)
            )
          );
        const stageIds = stageRows.map((s) => s.id);
        if (stageIds.length === 0) {
          return NextResponse.json({ conversations: [], numbers: [] });
        }
        conditions.push(inArray(lead.stageId, stageIds));
      }

      // tag → joinar leadTagAssignment
      const candidateLeads = tagId
        ? await db
            .select({ id: lead.id, convId: lead.crmConversationId })
            .from(lead)
            .innerJoin(leadTagAssignment, eq(leadTagAssignment.leadId, lead.id))
            .where(and(...conditions, eq(leadTagAssignment.tagId, tagId)))
        : await db
            .select({ id: lead.id, convId: lead.crmConversationId })
            .from(lead)
            .where(and(...conditions));

      restrictToConvIds = candidateLeads
        .map((l) => l.convId)
        .filter((v): v is string => !!v);

      // Se não tem nenhum conv vinculado ao filtro, retorna vazio
      if (restrictToConvIds.length === 0) {
        return NextResponse.json({ conversations: [], numbers: [] });
      }
    }

    // Filtrar por tenants visíveis (regra absoluta #1)
    const whereConditions = [inArray(crmConversation.tenantId, effectiveTenantIds)];
    if (numberId) whereConditions.push(eq(crmConversation.whatsappNumberId, numberId));
    if (classification) whereConditions.push(eq(crmConversation.classification, classification));
    if (restrictToConvIds) whereConditions.push(inArray(crmConversation.id, restrictToConvIds));

    const conversations = await db
      .select({
        id: crmConversation.id,
        tenantId: crmConversation.tenantId,
        whatsappNumberId: crmConversation.whatsappNumberId,
        contactPhone: crmConversation.contactPhone,
        contactJid: crmConversation.contactJid,
        contactName: crmConversation.contactName,
        contactPushName: crmConversation.contactPushName,
        classification: crmConversation.classification,
        lastMessageAt: crmConversation.lastMessageAt,
        unreadCount: crmConversation.unreadCount,
        contactProfilePicUrl: crmConversation.contactProfilePicUrl,
        contactAlias: crmConversation.contactAlias,
        updatedAt: crmConversation.updatedAt,
        numberLabel: whatsappNumber.label,
        numberPhone: whatsappNumber.phoneNumber,
      })
      .from(crmConversation)
      .leftJoin(whatsappNumber, eq(crmConversation.whatsappNumberId, whatsappNumber.id))
      .where(and(...whereConditions))
      .orderBy(desc(crmConversation.lastMessageAt));

    const numbers = await db
      .select()
      .from(whatsappNumber)
      .where(and(eq(whatsappNumber.isActive, true), inArray(whatsappNumber.tenantId, effectiveTenantIds)));

    // ── Preview da última msg por conversa (1 query LIMIT 1 por conv,
    //    em paralelo). Mais previsível que JOIN + DISTINCT ON.
    const convIds = conversations.map((c) => c.id);
    const lastMsgByConv = new Map<
      string,
      { content: string | null; mediaType: string | null; direction: string }
    >();
    if (convIds.length > 0) {
      await Promise.all(
        convIds.map(async (cid) => {
          const [m] = await db
            .select({
              content: crmMessage.content,
              mediaType: crmMessage.mediaType,
              direction: crmMessage.direction,
            })
            .from(crmMessage)
            .where(eq(crmMessage.conversationId, cid))
            .orderBy(desc(crmMessage.timestamp))
            .limit(1);
          if (m) lastMsgByConv.set(cid, m);
        })
      );
    }

    const conversationsWithPreview = conversations.map((c) => {
      const last = lastMsgByConv.get(c.id);
      return {
        ...c,
        tenantName: tenantNameById.get(c.tenantId) ?? null,
        lastMessagePreview: last ? buildPreview(last.content, last.mediaType) : null,
        lastMessageDirection: last?.direction ?? null,
        lastMessageMediaType: last?.mediaType ?? null,
      };
    });

    return NextResponse.json({
      conversations: conversationsWithPreview,
      numbers,
      tenants: visibleTenants,
    });
  } catch {
    console.error("[CRM] GET failed:", { operation: "list" });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
