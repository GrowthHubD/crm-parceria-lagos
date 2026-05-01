import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation, automationStep } from "@/lib/db/schema/automations";
import { pipelineStage, leadTag } from "@/lib/db/schema/pipeline";
import { eq, asc, desc } from "drizzle-orm";
import type { UserRole } from "@/types";
import { AutomationsList } from "@/components/automations/automations-list";
import { QuickAutomationSetup } from "@/components/automations/quick-setup";
import { ScheduledAutomationEditor } from "@/components/automations/scheduled-editor";
import { FollowUpList } from "@/components/automations/follow-up-list";

export const metadata: Metadata = { title: "Automações" };

// Lista de automações muda raramente — 60s de cache server-side é seguro.
export const revalidate = 60;

export default async function AutomationsPage() {
  let tenantCtx;
  try {
    tenantCtx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  const userRole = tenantCtx.role as UserRole;
  const [canView, canEdit] = await Promise.all([
    checkPermission(tenantCtx.userId, userRole, "automations", "view", tenantCtx),
    checkPermission(tenantCtx.userId, userRole, "automations", "edit", tenantCtx),
  ]);
  if (!canView) redirect("/");

  const [automations, allSteps, stages, tags] = await Promise.all([
    db
      .select()
      .from(automation)
      .where(eq(automation.tenantId, tenantCtx.tenantId))
      .orderBy(desc(automation.createdAt)),
    db.select().from(automationStep).orderBy(asc(automationStep.order)),
    db
      .select({ id: pipelineStage.id, name: pipelineStage.name })
      .from(pipelineStage)
      .where(eq(pipelineStage.tenantId, tenantCtx.tenantId))
      .orderBy(asc(pipelineStage.order)),
    db
      .select({ id: leadTag.id, name: leadTag.name, color: leadTag.color })
      .from(leadTag)
      .where(eq(leadTag.tenantId, tenantCtx.tenantId))
      .orderBy(asc(leadTag.name)),
  ]);

  const automationsWithSteps = automations.map((a) => ({
    ...a,
    triggerConfig: a.triggerConfig as Record<string, unknown> | null,
    steps: allSteps.filter((s) => s.automationId === a.id).map((s) => ({
      ...s,
      config: s.config as Record<string, unknown>,
      createdAt: s.createdAt.toISOString(),
    })),
    createdAt: a.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-8">
      <AutomationsList
        initialAutomations={automationsWithSteps}
        stages={stages}
        canEdit={canEdit}
      />

      {canEdit && (
        <>
          <div>
            <h2 className="text-lg font-semibold mb-3 text-foreground">Boas-vindas</h2>
            <QuickAutomationSetup
              existing={automationsWithSteps.map((a) => ({
                id: a.id,
                triggerType: a.triggerType,
                triggerConfig: a.triggerConfig,
                isActive: a.isActive,
                steps: a.steps.map((s) => ({
                  id: s.id,
                  type: s.type,
                  config: s.config,
                })),
              }))}
            />
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-1 text-foreground">Follow-ups de inativos</h2>
            <p className="text-small text-muted mb-3">
              Dispara quando VOCÊ respondeu por último e o contato não retornou.
              Configurável em minutos, horas ou dias. ⚠ Não dispara em grupos.
            </p>
            <FollowUpList
              followUps={automationsWithSteps
                .filter((a) => a.triggerType === "lead_inactive")
                .map((a) => ({
                  id: a.id,
                  name: a.name,
                  description: a.description,
                  triggerConfig: a.triggerConfig,
                  isActive: a.isActive,
                  steps: a.steps.map((s) => ({
                    id: s.id,
                    type: s.type,
                    config: s.config,
                  })),
                }))}
            />
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-1 text-foreground">
              Envios em massa e agendamentos
            </h2>
            <p className="text-small text-muted mb-3">
              Envia mensagens pra grupos de leads filtrados — agora, em data específica, ou recorrente.
            </p>
            <ScheduledAutomationEditor stages={stages} tags={tags} />
          </div>
        </>
      )}
    </div>
  );
}
