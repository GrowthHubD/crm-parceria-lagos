import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { whatsappNumber } from "@/lib/db/schema/crm";
import { eq } from "drizzle-orm";
import { deleteInstance } from "@/lib/whatsapp";
import type { UserRole } from "@/types";

/**
 * POST /api/uazapi/disconnect
 * Remove/desconecta a instância no provider ativo e marca isActive=false.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "configuracoes", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const targetTenantId = (ctx.role === "superadmin" && body.tenantId) ? body.tenantId : ctx.tenantId;

    const [wNum] = await db
      .select()
      .from(whatsappNumber)
      .where(eq(whatsappNumber.tenantId, targetTenantId))
      .limit(1);

    if (!wNum) return NextResponse.json({ ok: true });

    if (wNum.uazapiSession && wNum.uazapiSession !== "baileys") {
      await deleteInstance(wNum.uazapiSession, wNum.uazapiToken || undefined);
    }

    await db
      .update(whatsappNumber)
      .set({ isActive: false, uazapiSession: "baileys" })
      .where(eq(whatsappNumber.id, wNum.id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[WHATSAPP] Disconnect failed:", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
