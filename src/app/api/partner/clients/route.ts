/**
 * Partner clients API — cria/lista clientes de um parceiro revendedor.
 *
 * Permissões:
 * - partner_admin: só vê/gerencia clientes com partner_id = seu tenant
 * - superadmin: vê todos os clientes de todos os parceiros
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { tenant } from "@/lib/db/schema/tenants";
import { whatsappNumber } from "@/lib/db/schema/crm";
import { eq, desc } from "drizzle-orm";
import { provisionClient } from "@/lib/provisioning";

const createSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(2).max(40),
  billingEmail: z.string().email().optional(),
  plan: z.enum(["free", "pro", "enterprise"]).optional(),
  adminEmail: z.string().email().optional(),
  adminName: z.string().min(2).max(80).optional(),
});

function canAccess(role: string) {
  return role === "partner_admin" || role === "superadmin";
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantContext(request.headers);
    if (!canAccess(ctx.role)) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    // Superadmin: lista todos | partner_admin: só os seus
    const whereClause =
      ctx.role === "superadmin" ? undefined : eq(tenant.partnerId, ctx.tenantId);

    const clientsQuery = db
      .select({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        billingStatus: tenant.billingStatus,
        billingEmail: tenant.billingEmail,
        createdAt: tenant.createdAt,
        whatsappActive: whatsappNumber.isActive,
        whatsappPhone: whatsappNumber.phoneNumber,
      })
      .from(tenant)
      .leftJoin(whatsappNumber, eq(whatsappNumber.tenantId, tenant.id))
      .orderBy(desc(tenant.createdAt));

    const clients = whereClause
      ? await clientsQuery.where(whereClause)
      : await clientsQuery;

    return NextResponse.json({ clients });
  } catch (e) {
    console.error("[PARTNER] GET clients failed:", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext(request.headers);
    if (!canAccess(ctx.role)) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // partner_admin provisiona SEMPRE com ele mesmo como partnerId.
    // superadmin pode criar cliente "solto" ou em nome de um parceiro — por
    // enquanto, sempre atrela ao tenant do ctx (ou do body.partnerId se vier).
    const partnerId =
      ctx.role === "superadmin" && typeof body.partnerId === "string"
        ? body.partnerId
        : ctx.tenantId;

    const result = await provisionClient({
      partnerId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      billingEmail: parsed.data.billingEmail,
      plan: parsed.data.plan,
      adminEmail: parsed.data.adminEmail,
      adminName: parsed.data.adminName,
    });

    return NextResponse.json({ client: result }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    console.error("[PARTNER] POST clients failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
