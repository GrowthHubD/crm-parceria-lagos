import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { pipeline, pipelineStage, leadTag } from "@/lib/db/schema/pipeline";
import { eq, desc, asc } from "drizzle-orm";
import { Inbox } from "@/components/crm/inbox";
import type { UserRole } from "@/types";

/** Mesma lógica do /api/crm — mantida em duplicidade pra evitar import server-only. */
function buildPreview(content: string | null, mediaType: string | null): string {
  const mt = (mediaType ?? "").toLowerCase();
  if (mt === "audio" || mt === "ptt" || mt === "voice") return "🎤 Áudio";
  if (mt === "image" || mt === "sticker") return content?.trim() ? `📷 ${content}` : "📷 Imagem";
  if (mt === "video") return content?.trim() ? `🎥 ${content}` : "🎥 Vídeo";
  if (mt === "document") return content?.trim() ? `📄 ${content}` : "📄 Documento";
  return content?.trim() || "Mensagem";
}

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

  const [conversations, numbers, tags, stages, funnels] = await Promise.all([
    db
      .select({
        id: crmConversation.id,
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
      .orderBy(desc(crmConversation.lastMessageAt)),
    db.select().from(whatsappNumber).where(eq(whatsappNumber.isActive, true)),
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
          initialConversations={await Promise.all(
            conversations.map(async (c) => {
              const [last] = await db
                .select({
                  content: crmMessage.content,
                  mediaType: crmMessage.mediaType,
                  direction: crmMessage.direction,
                })
                .from(crmMessage)
                .where(eq(crmMessage.conversationId, c.id))
                .orderBy(desc(crmMessage.timestamp))
                .limit(1);
              return {
                ...c,
                lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
                lastMessagePreview: last ? buildPreview(last.content, last.mediaType) : null,
                lastMessageDirection: last?.direction ?? null,
                lastMessageMediaType: last?.mediaType ?? null,
              };
            })
          )}
          numbers={numbers}
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
