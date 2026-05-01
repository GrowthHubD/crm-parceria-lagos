import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { crmConversation, whatsappNumber } from "@/lib/db/schema/crm";
import { pipeline, pipelineStage, leadTag } from "@/lib/db/schema/pipeline";
import { tenant } from "@/lib/db/schema/tenants";
import { and, eq, desc, asc, inArray, or } from "drizzle-orm";
import { Inbox } from "@/components/crm/inbox";
import type { UserRole } from "@/types";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;

  const [canView, canEdit] = await Promise.all([
    checkPermission(session.user.id, userRole, "crm", "view"),
    checkPermission(session.user.id, userRole, "crm", "edit"),
  ]);

  if (!canView) redirect("/");

  // ── Resolve tenant context + tenants visíveis ───────────────────────
  // Regra absoluta #1: toda query precisa de tenant_id no WHERE.
  // - Platform owner (GH) vê todos os tenants (cross-tenant inbox)
  // - Partner com role superadmin/admin vê o próprio + filhos (partnerId = self)
  // - Resto vê apenas o próprio tenant
  let tenantCtx;
  try {
    tenantCtx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  const visibleTenants = await (async () => {
    if (tenantCtx.isPlatformOwner) {
      return db
        .select({ id: tenant.id, name: tenant.name, slug: tenant.slug })
        .from(tenant)
        .where(eq(tenant.status, "active"))
        .orderBy(asc(tenant.name));
    }
    if (tenantCtx.role === "superadmin" || tenantCtx.role === "admin") {
      return db
        .select({ id: tenant.id, name: tenant.name, slug: tenant.slug })
        .from(tenant)
        .where(or(eq(tenant.id, tenantCtx.tenantId), eq(tenant.partnerId, tenantCtx.tenantId)))
        .orderBy(asc(tenant.name));
    }
    return db
      .select({ id: tenant.id, name: tenant.name, slug: tenant.slug })
      .from(tenant)
      .where(eq(tenant.id, tenantCtx.tenantId));
  })();

  const visibleTenantIds = visibleTenants.map((t) => t.id);
  const tenantNameById = new Map(visibleTenants.map((t) => [t.id, t.name]));

  const [conversations, numbers, tags, stages, funnels] = await Promise.all([
    db
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
        numberLabel: whatsappNumber.label,
        numberPhone: whatsappNumber.phoneNumber,
      })
      .from(crmConversation)
      .leftJoin(whatsappNumber, eq(crmConversation.whatsappNumberId, whatsappNumber.id))
      .where(inArray(crmConversation.tenantId, visibleTenantIds))
      .orderBy(desc(crmConversation.lastMessageAt))
      // SSR carrega só 30 conversas — resto/preview vem via /api/crm no mount.
      // (Worker 1102 quando SSR processava 100+DISTINCT ON em crm_message.)
      .limit(30),
    db
      .select()
      .from(whatsappNumber)
      .where(and(eq(whatsappNumber.isActive, true), inArray(whatsappNumber.tenantId, visibleTenantIds))),
    // Tags + stages + funnels para o componente compartilhado de filtros.
    db.select({ id: leadTag.id, name: leadTag.name, color: leadTag.color }).from(leadTag).orderBy(asc(leadTag.name)),
    db
      .select({
        id: pipelineStage.id,
        name: pipelineStage.name,
        color: pipelineStage.color,
        pipelineId: pipelineStage.pipelineId,
      })
      .from(pipelineStage)
      .orderBy(asc(pipelineStage.order)),
    db
      .select({ id: pipeline.id, name: pipeline.name })
      .from(pipeline)
      .orderBy(asc(pipeline.createdAt)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">CRM</h1>
        <p className="text-muted mt-1">Inbox de mensagens WhatsApp</p>
      </div>

      {numbers.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-12 text-center">
          <p className="text-muted text-sm">Nenhum número WhatsApp cadastrado.</p>
          <p className="text-small text-muted/60 mt-2">
            Configure os números na tabela <code className="font-mono bg-surface-2 px-1 rounded">whatsapp_number</code> para começar a receber mensagens.
          </p>
        </div>
      ) : (
        <Inbox
          // Skel inicial — sem preview de última msg. Inbox refaz fetch ao mount
          // e popula previews via /api/crm. Mantém SSR barato (Worker CPU limit).
          initialConversations={conversations.map((c) => ({
            ...c,
            tenantName: tenantNameById.get(c.tenantId) ?? null,
            lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
            lastMessagePreview: null,
            lastMessageDirection: null,
            lastMessageMediaType: null,
          }))}
          numbers={numbers}
          tenants={visibleTenants}
          canEdit={canEdit}
          currentUserId={session.user.id}
          tags={tags}
          stages={stages}
          funnels={funnels}
        />
      )}
    </div>
  );
}
