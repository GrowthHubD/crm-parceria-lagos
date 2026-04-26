import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { whatsappNumber } from "@/lib/db/schema/crm";
import { eq } from "drizzle-orm";
import { getStatus } from "@/lib/whatsapp";

/**
 * GET /api/uazapi/status?tenantId=xxx (superadmin)
 * Retorna status da conexão WhatsApp via provider ativo (Evolution em dev, Uazapi em prod).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantContext(request.headers);
    const targetTenantId = request.nextUrl.searchParams.get("tenantId") ?? ctx.tenantId;

    if (targetTenantId !== ctx.tenantId && ctx.role !== "superadmin") {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const [wNum] = await db
      .select()
      .from(whatsappNumber)
      .where(eq(whatsappNumber.tenantId, targetTenantId))
      .limit(1);

    if (!wNum || !wNum.uazapiSession || wNum.uazapiSession === "baileys") {
      return NextResponse.json({ status: "not_configured", connected: false });
    }

    const status = await getStatus(wNum.uazapiSession, wNum.uazapiToken || undefined);

    if (status.state === "open") {
      if (!wNum.isActive) {
        await db
          .update(whatsappNumber)
          .set({
            isActive: true,
            ...(status.phoneNumber ? { phoneNumber: status.phoneNumber } : {}),
          })
          .where(eq(whatsappNumber.id, wNum.id));
      }
      return NextResponse.json({
        status: "connected",
        connected: true,
        phoneNumber: status.phoneNumber ?? wNum.phoneNumber,
        instanceId: wNum.id,
      });
    }

    if (status.state === "connecting") {
      return NextResponse.json({
        status: "pending",
        connected: false,
        instanceId: wNum.id,
      });
    }

    return NextResponse.json({
      status: "not_configured",
      connected: false,
      instanceId: wNum.id,
    });
  } catch {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
