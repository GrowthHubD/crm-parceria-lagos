import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { modulePermission } from "@/lib/db/schema/users";
import { eq, and } from "drizzle-orm";
import type { UserRole } from "@/types";

const upsertSchema = z.object({
  module: z.enum(["dashboard", "pipeline", "contracts", "financial", "crm", "clients", "sdr", "kanban", "blog", "admin"]),
  canView: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext(request.headers).catch(() => null);
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const canEdit = await checkPermission(ctx.userId, ctx.role as UserRole, "admin", "edit", ctx);
    if (!canEdit) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

    const body = await request.json();
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const d = parsed.data;

    // Upsert: delete existing then insert
    await db
      .delete(modulePermission)
      .where(and(eq(modulePermission.userId, id), eq(modulePermission.module, d.module)));

    const [perm] = await db
      .insert(modulePermission)
      .values({
        userId: id,
        module: d.module,
        canView: d.canView,
        canEdit: d.canEdit,
        canDelete: d.canDelete,
      })
      .returning();

    return NextResponse.json({ permission: perm });
  } catch {
    console.error("[ADMIN] PUT permission failed");
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
