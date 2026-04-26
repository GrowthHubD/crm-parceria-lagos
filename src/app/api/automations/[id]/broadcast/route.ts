/**
 * POST /api/automations/[id]/broadcast
 *
 * Dispara IMEDIATAMENTE uma automação `manual_broadcast` (ou qualquer outra)
 * pra todos os leads que casam com o audienceFilter dela.
 *
 * Uso: botão "Enviar agora" no painel.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation } from "@/lib/db/schema/automations";
import { eq } from "drizzle-orm";
import { triggerBroadcast, processPendingAutomations } from "@/lib/automations/runner";
import type { UserRole } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers);
    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "automations", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    // Valida que a automation pertence ao tenant
    const [auto] = await db
      .select({ id: automation.id, tenantId: automation.tenantId })
      .from(automation)
      .where(eq(automation.id, id))
      .limit(1);

    if (!auto || auto.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });
    }

    const result = await triggerBroadcast({ automationId: id });
    // Processa pendentes imediatamente (pra steps sem delay enviarem agora)
    const processed = await processPendingAutomations(500);

    return NextResponse.json({
      targeted: result.targeted,
      scheduled: result.scheduled,
      sent: processed.sent,
      failed: processed.failed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    console.error("[BROADCAST]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
