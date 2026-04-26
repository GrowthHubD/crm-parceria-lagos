import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/schema/notifications";
import { eq, desc } from "drizzle-orm";
import { NotificationList } from "@/components/notificacoes/notification-list";

export const metadata: Metadata = { title: "Notificações" };

export default async function NotificacoesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const notifications = await db
    .select()
    .from(notification)
    .where(eq(notification.userId, session.user.id))
    .orderBy(desc(notification.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Notificações</h1>
        <p className="text-muted mt-1">Alertas e avisos do sistema</p>
      </div>

      <NotificationList
        initialNotifications={notifications.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          type: n.type,
          module: n.module ?? null,
          link: n.link ?? null,
          isRead: n.isRead,
          createdAt: n.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
