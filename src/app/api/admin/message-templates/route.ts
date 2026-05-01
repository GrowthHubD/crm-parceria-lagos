import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { messageTemplate } from "@/lib/db/schema/settings";
import { eq } from "drizzle-orm";
import type { UserRole } from "@/types";

const TEMPLATE_DEFAULTS: Array<{ id: string; label: string; body: string }> = [
  {
    id: "daily_reminder",
    label: "Lembrete diário de tarefas",
    body: "📋 *Tarefas de hoje, {{data}}*\n\nOlá, {{nome}}! Você tem {{qtd}} tarefa(s) para hoje:\n\n{{tarefas}}\n\n_Growth Hub Manager_",
  },
  {
    id: "weekly_digest",
    label: "Resumo semanal de tarefas",
    body: "📅 *Resumo da semana ({{semana}})*\n\nOlá, {{nome}}! Você tem {{qtd}} tarefa(s) essa semana:\n\n{{tarefas}}\n\n_Growth Hub Manager_",
  },
  {
    id: "contract_alert",
    label: "Alerta de contratos a vencer",
    body: "⚠️ *{{qtd}} contrato(s) a vencer em 30 dias:*\n\n{{contratos}}\n\n_Growth Hub Manager_",
  },
];

export const TEMPLATE_VARIABLES: Record<string, string[]> = {
  daily_reminder: ["{{nome}}", "{{data}}", "{{qtd}}", "{{tarefas}}"],
  weekly_digest: ["{{nome}}", "{{semana}}", "{{qtd}}", "{{tarefas}}"],
  contract_alert: ["{{qtd}}", "{{contratos}}"],
};

/** GET — return all templates (merged with defaults for missing rows) */
export async function GET() {
  try {
    const ctx = await getTenantContext(await headers()).catch(() => null);
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const role = ctx.role as UserRole;
    if (role !== "partner" && role !== "superadmin" && role !== "admin") {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    let rows: typeof TEMPLATE_DEFAULTS = [];
    try {
      const dbRows = await db.select().from(messageTemplate);
      const dbMap = new Map(dbRows.map((r) => [r.id, r]));

      rows = TEMPLATE_DEFAULTS.map((def) => {
        const saved = dbMap.get(def.id);
        return {
          id: def.id,
          label: def.label,
          body: saved?.body ?? def.body,
          variables: TEMPLATE_VARIABLES[def.id] ?? [],
          updatedAt: saved?.updatedAt ?? null,
        };
      });
    } catch {
      // Table not yet created — return defaults
      rows = TEMPLATE_DEFAULTS.map((d) => ({
        ...d,
        variables: TEMPLATE_VARIABLES[d.id] ?? [],
        updatedAt: null,
      }));
    }

    return NextResponse.json({ templates: rows });
  } catch (error) {
    console.error("[ADMIN] GET message-templates failed:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/** PATCH — upsert one template */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantContext(await headers()).catch(() => null);
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const role = ctx.role as UserRole;
    if (role !== "partner" && role !== "superadmin" && role !== "admin") {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await request.json();
    const { id, templateBody } = body as { id: string; templateBody: string };

    if (!id || typeof templateBody !== "string" || !templateBody.trim()) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const validId = TEMPLATE_DEFAULTS.find((d) => d.id === id);
    if (!validId) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

    const label = validId.label;

    // Upsert
    const existing = await db
      .select({ id: messageTemplate.id })
      .from(messageTemplate)
      .where(eq(messageTemplate.id, id))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(messageTemplate)
        .set({ body: templateBody.trim(), updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(messageTemplate.id, id));
    } else {
      await db.insert(messageTemplate).values({
        id,
        label,
        body: templateBody.trim(),
        updatedBy: ctx.userId,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ADMIN] PATCH message-template failed:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/** DELETE — reset one template to default */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantContext(await headers()).catch(() => null);
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const role = ctx.role as UserRole;
    if (role !== "partner" && role !== "superadmin" && role !== "admin") {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

    await db.delete(messageTemplate).where(eq(messageTemplate.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ADMIN] DELETE message-template failed:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
