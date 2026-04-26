/**
 * Preview da cadeia de follow-ups — QUERY-ONLY.
 *
 * Calcula qual é a PRÓXIMA automação `lead_inactive` que vai disparar pra um
 * lead (ou batch de leads), e quando.
 *
 * Espelha a semântica de `scheduleInactiveLeadFollowups` em runner.ts (cadeia
 * sequencial, thresholds incrementais, ciclo baseado em lastOutgoingAt), mas
 * NUNCA insere logs nem envia nada. É pura observação de estado.
 *
 * Uso:
 *   - UI do CRM header e do Kanban card: mostrar "🕒 Próximo: X em ~Ymin"
 *   - Pipeline API (batch) pra evitar N+1
 */

import { db } from "../db";
import { automation, automationLog } from "../db/schema/automations";
import { lead } from "../db/schema/pipeline";
import { crmConversation } from "../db/schema/crm";
import { and, eq, inArray, gt, asc } from "drizzle-orm";
import type { TriggerConfig } from "./runner";

export interface NextFollowUp {
  automationId: string;
  automationName: string;
  scheduledAt: Date;
  status: "pending" | "upcoming";
}

function computeInactivityMs(cfg: TriggerConfig): number {
  const d = cfg.inactiveDays ?? 0;
  const h = cfg.inactiveHours ?? 0;
  const m = cfg.inactiveMinutes ?? 0;
  const total = d * 86_400_000 + h * 3_600_000 + m * 60_000;
  return total > 0 ? total : 3 * 86_400_000;
}

interface ChainLink {
  id: string;
  name: string;
  thresholdMs: number;
}

/**
 * Retorna a cadeia ordenada por threshold asc pro tenant.
 * Em produção ignora autos com `dry_run=true` (se o AUTOMATION_DRY_RUN=false).
 */
async function loadChain(tenantId: string): Promise<ChainLink[]> {
  const isDry = process.env.AUTOMATION_DRY_RUN === "true";

  const autos = await db
    .select({
      id: automation.id,
      name: automation.name,
      triggerConfig: automation.triggerConfig,
      dryRun: automation.dryRun,
    })
    .from(automation)
    .where(
      and(
        eq(automation.tenantId, tenantId),
        eq(automation.triggerType, "lead_inactive"),
        eq(automation.isActive, true)
      )
    );

  return autos
    .filter((a) => (isDry ? a.dryRun === true : a.dryRun === false))
    .map((a) => ({
      id: a.id,
      name: a.name,
      thresholdMs: computeInactivityMs((a.triggerConfig as TriggerConfig) ?? {}),
    }))
    .sort((x, y) => x.thresholdMs - y.thresholdMs);
}

interface LeadConvState {
  leadId: string;
  lastOutgoingAt: Date | null;
  lastIncomingAt: Date | null;
  isGroup: boolean;
}

async function loadLeadConvs(leadIds: string[]): Promise<Map<string, LeadConvState>> {
  if (leadIds.length === 0) return new Map();
  const rows = await db
    .select({
      leadId: lead.id,
      lastOutgoingAt: crmConversation.lastOutgoingAt,
      lastIncomingAt: crmConversation.lastIncomingAt,
      isGroup: crmConversation.isGroup,
    })
    .from(lead)
    .leftJoin(crmConversation, eq(crmConversation.id, lead.crmConversationId))
    .where(inArray(lead.id, leadIds));
  return new Map(rows.map((r) => [r.leadId, r as LeadConvState]));
}

interface LogRow {
  leadId: string;
  automationId: string;
  status: string;
  executedAt: Date | null;
  scheduledAt: Date;
  createdAt: Date;
}

async function loadLogsInCycle(
  leadIds: string[],
  autoIds: string[],
  convStates: Map<string, LeadConvState>
): Promise<Map<string, LogRow[]>> {
  if (leadIds.length === 0 || autoIds.length === 0) return new Map();
  const rows = await db
    .select({
      leadId: automationLog.leadId,
      automationId: automationLog.automationId,
      status: automationLog.status,
      executedAt: automationLog.executedAt,
      scheduledAt: automationLog.scheduledAt,
      createdAt: automationLog.createdAt,
    })
    .from(automationLog)
    .where(
      and(
        inArray(automationLog.leadId, leadIds),
        inArray(automationLog.automationId, autoIds)
      )
    );

  const byLead = new Map<string, LogRow[]>();
  for (const r of rows) {
    if (!r.leadId) continue;
    const conv = convStates.get(r.leadId);
    // Só considera logs do ciclo atual (createdAt > lastOutgoingAt).
    if (conv?.lastOutgoingAt && r.createdAt <= conv.lastOutgoingAt) continue;
    const arr = byLead.get(r.leadId) ?? [];
    arr.push(r as LogRow);
    byLead.set(r.leadId, arr);
  }
  return byLead;
}

/**
 * Dado o estado do lead e a cadeia, computa o próximo follow-up.
 * Retorna null quando chain bloqueada, lead inelegível ou cadeia exaurida.
 */
function computeNext(
  conv: LeadConvState | undefined,
  chain: ChainLink[],
  logs: LogRow[]
): NextFollowUp | null {
  if (!conv || chain.length === 0) return null;
  if (conv.isGroup) return null;
  if (!conv.lastOutgoingAt) return null;
  // Lead respondeu depois → ciclo encerrado
  if (conv.lastIncomingAt && conv.lastIncomingAt > conv.lastOutgoingAt) return null;

  const logByAutoId = new Map<string, LogRow>(logs.map((l) => [l.automationId, l]));

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    const existing = logByAutoId.get(link.id);

    if (existing) {
      if (existing.status === "sent") continue; // step completou; vê o próximo
      if (existing.status === "pending" || existing.status === "processing") {
        return {
          automationId: link.id,
          automationName: link.name,
          scheduledAt: existing.scheduledAt,
          status: "pending",
        };
      }
      // failed | skipped → cadeia bloqueada
      return null;
    }

    // Não há log ainda — calcula ETA a partir do anchor
    let anchor: Date;
    if (i === 0) {
      anchor = conv.lastOutgoingAt;
    } else {
      const prev = logByAutoId.get(chain[i - 1].id);
      if (!prev || prev.status !== "sent" || !prev.executedAt) {
        // prev não terminou bem → chain não avança
        return null;
      }
      anchor = prev.executedAt;
    }
    return {
      automationId: link.id,
      automationName: link.name,
      scheduledAt: new Date(anchor.getTime() + link.thresholdMs),
      status: "upcoming",
    };
  }

  return null; // cadeia inteira já sent
}

/** Versão single-lead — usada pelo CRM conversation view. */
export async function getNextFollowUp(params: {
  tenantId: string;
  leadId: string;
}): Promise<NextFollowUp | null> {
  const chain = await loadChain(params.tenantId);
  if (chain.length === 0) return null;

  const convs = await loadLeadConvs([params.leadId]);
  const conv = convs.get(params.leadId);
  if (!conv) return null;

  const logs = await loadLogsInCycle(
    [params.leadId],
    chain.map((c) => c.id),
    convs
  );
  return computeNext(conv, chain, logs.get(params.leadId) ?? []);
}

/** Versão batch — usada pelo Pipeline kanban pra evitar N+1. */
export async function getNextFollowUpBatch(
  tenantId: string,
  leadIds: string[]
): Promise<Map<string, NextFollowUp | null>> {
  const out = new Map<string, NextFollowUp | null>();
  if (leadIds.length === 0) return out;

  const chain = await loadChain(tenantId);
  if (chain.length === 0) {
    for (const id of leadIds) out.set(id, null);
    return out;
  }

  const convs = await loadLeadConvs(leadIds);
  const logsByLead = await loadLogsInCycle(
    leadIds,
    chain.map((c) => c.id),
    convs
  );

  for (const id of leadIds) {
    const conv = convs.get(id);
    const logs = logsByLead.get(id) ?? [];
    out.set(id, computeNext(conv, chain, logs));
  }
  return out;
}
