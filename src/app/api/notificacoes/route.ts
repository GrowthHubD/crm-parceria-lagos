import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDevSession } from "@/lib/tenant";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/schema/notifications";
import { eq, and, desc } from "drizzle-orm";

const isDev = process.env.NODE_ENV === "development";

export async function GET(request: NextRequest) {
  try {
    let session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
    if (!session && isDev) {
      const dev = await getDevSession();
      session = dev as unknown as typeof session;
    }
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread") === "true";

    const conditions = [eq(notification.userId, session.user.id)];
    if (unreadOnly) conditions.push(eq(notification.isRead, false));

    const notifications = await db
      .select()
      .from(notification)
      .where(and(...conditions))
      .orderBy(desc(notification.createdAt))
      .limit(50);

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch {
    console.error("[NOTIF] GET failed");
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
