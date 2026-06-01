import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/permissions";
import { getTenantContext, getVisibleTenants } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { lead, leadTagAssignment, pipelineStage } from "@/lib/db/schema/pipeline";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
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

    // ── Tenants visíveis para este user (helper compartilhado — mesma regra
    //    do SSR em /crm/page.tsx e das rotas de conversa individual).
    const visibleTenants = await getVisibleTenants(ctx);
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

    // Paginação inicial: 50 conversas mais recentes. Em tenants com 500+ convs
    // (Lagos), carregar tudo era ~2-5s. Cursor-based paging (?before=<ts>) fica
    // pro Bloco 2 — agora só limita o blast radius do payload e do JSON parse.
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
      .orderBy(desc(crmConversation.lastMessageAt))
      .limit(50);

    const numbers = await db
      .select()
      .from(whatsappNumber)
      .where(and(eq(whatsappNumber.isActive, true), inArray(whatsappNumber.tenantId, effectiveTenantIds)));

    // ── Preview da última msg por conversa em UMA query (DISTINCT ON).
    //    Antes: 1 query por conversa via Promise.all → com 50 convs = 50
    //    roundtrips Hyperdrive (max:1 client em src/lib/db/index.ts:65) → 2-5s
    //    de "CRM travado pra carregar".
    //    Agora: 1 query só, usando DISTINCT ON específico do Postgres.
    const convIds = conversations.map((c) => c.id);
    const lastMsgByConv = new Map<
      string,
      { content: string | null; mediaType: string | null; direction: string }
    >();
    if (convIds.length > 0) {
      const rows = (await db.execute(sql`
        SELECT DISTINCT ON (conversation_id)
          conversation_id, content, media_type, direction
        FROM crm_message
        WHERE conversation_id IN (${sql.join(convIds.map((c) => sql`${c}`), sql`, `)})
        ORDER BY conversation_id, timestamp DESC
      `)) as unknown as Array<{
        conversation_id: string;
        content: string | null;
        media_type: string | null;
        direction: string;
      }>;
      for (const r of rows) {
        lastMsgByConv.set(r.conversation_id, {
          content: r.content,
          mediaType: r.media_type,
          direction: r.direction,
        });
      }
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
  } catch (e) {
    return handleApiError(e, "CRM GET");
  }
}
