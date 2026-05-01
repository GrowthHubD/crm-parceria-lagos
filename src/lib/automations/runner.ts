/**
 * Engine de execução de automações.
 *
 * Triggers suportados:
 * - `first_message` — dispara quando contato manda a primeira mensagem (lead novo)
 * - `lead_inactive` — dispara quando "operator respondeu por último e lead não
 *                     retornou em N dias" (NÃO é genérico "sem mensagem")
 * - `stage_enter` — dispara quando lead entra numa stage específica (futuro)
 * - `tag_added` — dispara quando tag é adicionada ao lead (futuro)
 *
 * Tipos de steps:
 * - `send_whatsapp` — envia mensagem pelo WhatsApp (com delay opcional)
 * - `wait` — só espera X minutos/horas antes do próximo step
 *
 * **IMPORTANTE:** automações JAMAIS disparam em conversas de grupo
 * (`crm_conversation.isGroup = true`). Filtragem tripla:
 *   1. Webhooks bloqueiam grupos antes de criar conversa/lead
 *   2. `triggerFirstMessage` verifica isGroup antes de agendar
 *   3. `processPendingAutomations` verifica isGroup antes de enviar
 *
 * **DRY_RUN:** se `AUTOMATION_DRY_RUN=true`, sendText não é chamado —
 * apenas loga. Útil pra testes E2E sem WhatsApp conectado.
 */

import { db } from "../db";
import { automation, automationStep, automationLog } from "../db/schema/automations";
import { lead, leadTagAssignment } from "../db/schema/pipeline";
import { crmConversation, crmMessage, whatsappNumber } from "../db/schema/crm";
import { eq, and, lte, gte, asc, gt, isNull, isNotNull, or, inArray, sql as sqlOp } from "drizzle-orm";
import { sendText } from "../whatsapp";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface StepConfig {
  message?: string;
  delayMinutes?: number;
  delayHours?: number;
  delayDays?: number;
}

export type TriggerType =
  | "first_message"
  | "lead_inactive"
  | "stage_enter"
  | "tag_added"
  | "manual";

export interface SendWindow {
  startHour: number; // 0-23, local no timezone
  endHour: number; // 0-23 (exclusive; 18 = até 17:59)
  timezone?: string; // default "America/Sao_Paulo"
}

export interface TriggerConfig {
  inactiveDays?: number; // para lead_inactive (legado — converte pra ms)
  inactiveHours?: number; // para lead_inactive
  inactiveMinutes?: number; // para lead_inactive
  sendWindow?: SendWindow; // se presente, só dispara dentro da janela
  stageId?: string; // para stage_enter
  tagId?: string; // para tag_added
}

/** Valida se a string é um IANA timezone aceito pelo runtime. */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Hora atual (0-23) no timezone dado (default BRT). */
function hourInTimezone(now: Date, tz: string): number {
  try {
    const s = now.toLocaleString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    });
    // "24" às vezes aparece em vez de "00" em alguns engines
    const h = parseInt(s, 10);
    if (Number.isNaN(h)) return now.getUTCHours();
    return h === 24 ? 0 : h;
  } catch {
    return now.getUTCHours();
  }
}

/** Verifica se `now` está dentro da janela configurada. Sem janela → sempre true. */
function isInSendWindow(w: SendWindow | undefined, now: Date): boolean {
  if (!w) return true;
  const requestedTz = w.timezone ?? "America/Sao_Paulo";
  const tz = isValidTimezone(requestedTz) ? requestedTz : "America/Sao_Paulo";
  const h = hourInTimezone(now, tz);
  // Janela normal: start < end. Ex: 9..18 → 9,10,...,17
  if (w.startHour < w.endHour) return h >= w.startHour && h < w.endHour;
  // Janela que cruza meia-noite: start > end. Ex: 22..6 → 22,23,0,1,2,3,4,5
  if (w.startHour > w.endHour) return h >= w.startHour || h < w.endHour;
  // start === end → janela nula, desabilita
  return false;
}

/** Calcula o threshold total em ms a partir do triggerConfig de lead_inactive. */
function computeInactivityMs(cfg: TriggerConfig): number {
  const d = cfg.inactiveDays ?? 0;
  const h = cfg.inactiveHours ?? 0;
  const m = cfg.inactiveMinutes ?? 0;
  const total = d * 86_400_000 + h * 3_600_000 + m * 60_000;
  // Fallback: 3 dias se nada configurado
  return total > 0 ? total : 3 * 86_400_000;
}

function isDryRun(): boolean {
  return process.env.AUTOMATION_DRY_RUN === "true";
}

/**
 * Filtro de isolamento dry_run:
 *   - Em DRY_RUN (processo de teste): vê SOMENTE autos com dry_run=true
 *   - Em produção: vê SOMENTE autos com dry_run=false
 * Garante isolamento total entre tests e prod, evitando que o ticker real
 * agende test autos ou que testes interfiram nas autos do usuário.
 */
function nonDryAutoFilter() {
  return isDryRun()
    ? eq(automation.dryRun, true)
    : eq(automation.dryRun, false);
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function computeDelayMs(cfg: StepConfig): number {
  let ms = 0;
  if (cfg.delayDays) ms += cfg.delayDays * 24 * 60 * 60 * 1000;
  if (cfg.delayHours) ms += cfg.delayHours * 60 * 60 * 1000;
  if (cfg.delayMinutes) ms += cfg.delayMinutes * 60 * 1000;
  return ms;
}

function renderTemplate(tpl: string, vars: Record<string, string | null | undefined>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
}

/**
 * Busca a conversation do lead pra verificar isGroup.
 * Retorna true se deve pular (grupo ou conversation não encontrada).
 */
async function shouldSkipLead(leadId: string): Promise<boolean> {
  const [row] = await db
    .select({
      convId: lead.crmConversationId,
      isGroup: crmConversation.isGroup,
    })
    .from(lead)
    .leftJoin(crmConversation, eq(crmConversation.id, lead.crmConversationId))
    .where(eq(lead.id, leadId))
    .limit(1);

  if (!row) return true; // lead não existe
  if (!row.convId) return false; // lead sem conversation — permitir (edge case)
  return row.isGroup === true;
}

// ─────────────────────────────────────────────────────────
// Triggers — agendam logs pendentes baseado em eventos
// ─────────────────────────────────────────────────────────

/**
 * Dispara automações de `first_message` para um lead recém-criado.
 * Chamado pelo webhook ao criar crm_conversation nova.
 */
export async function triggerFirstMessage(params: {
  tenantId: string;
  leadId: string;
}): Promise<{ scheduled: number }> {
  // Defesa em profundidade: nunca dispara pra grupos
  if (await shouldSkipLead(params.leadId)) {
    return { scheduled: 0 };
  }

  const autos = await db
    .select()
    .from(automation)
    .where(
      and(
        eq(automation.tenantId, params.tenantId),
        eq(automation.triggerType, "first_message"),
        eq(automation.isActive, true),
        nonDryAutoFilter()
      )
    );

  let scheduled = 0;

  for (const a of autos) {
    const steps = await db
      .select()
      .from(automationStep)
      .where(eq(automationStep.automationId, a.id))
      .orderBy(asc(automationStep.order));

    let scheduledAt = new Date();
    for (const step of steps) {
      const cfg = (step.config as StepConfig) ?? {};
      scheduledAt = new Date(scheduledAt.getTime() + computeDelayMs(cfg));

      // INSERT atomic race-safe: o partial unique index `uq_autolog_welcome`
      // rejeita qualquer duplicata de (automation_id, lead_id) quando
      // trigger_type = 'first_message'. onConflictDoNothing torna a segunda
      // chamada concorrente um no-op (sem scheduled++).
      const inserted = await db
        .insert(automationLog)
        .values({
          automationId: a.id,
          leadId: params.leadId,
          stepId: step.id,
          triggerType: a.triggerType,
          status: "pending",
          scheduledAt,
          dryRun: isDryRun(),
        })
        .onConflictDoNothing()
        .returning({ id: automationLog.id });

      if (inserted.length > 0) scheduled++;
    }
  }

  return { scheduled };
}

/**
 * Agenda follow-ups pra leads "abandonados", em CADEIA sequencial:
 *   - Todos os `lead_inactive` ativos do tenant formam uma cadeia ordenada
 *     por threshold crescente (ex: 1min → 3min → 1h)
 *   - Cada step dispara UMA vez por ciclo (ciclo = intervalo entre respostas do lead)
 *   - Step N só dispara se step N-1 já foi `sent` no ciclo atual
 *   - Sem próximo step → cadeia para
 *   - `lastIncomingAt` novo reseta todo o progresso (logs antigos ficam fora do filtro)
 *   - Conversa de grupo nunca entra
 *   - Falha/skip em step bloqueia a cadeia (só `sent` destrava o próximo)
 */
export async function scheduleInactiveLeadFollowups(params: {
  tenantId?: string; // se omitido, processa todos os tenants
}): Promise<{ scheduled: number; evaluated: number; eligible: number }> {
  let scheduled = 0;
  let evaluated = 0;
  let eligible = 0;

  const whereAuto = params.tenantId
    ? and(
        eq(automation.triggerType, "lead_inactive"),
        eq(automation.isActive, true),
        eq(automation.tenantId, params.tenantId),
        nonDryAutoFilter()
      )
    : and(
        eq(automation.triggerType, "lead_inactive"),
        eq(automation.isActive, true),
        nonDryAutoFilter()
      );

  const autos = await db.select().from(automation).where(whereAuto);

  // Agrupa por tenant + ordena cadeia por threshold asc
  const byTenant = new Map<
    string,
    Array<{ auto: typeof autos[number]; thresholdMs: number }>
  >();
  for (const a of autos) {
    const thresholdMs = computeInactivityMs((a.triggerConfig as TriggerConfig) ?? {});
    const arr = byTenant.get(a.tenantId) ?? [];
    arr.push({ auto: a, thresholdMs });
    byTenant.set(a.tenantId, arr);
  }
  for (const chain of byTenant.values()) {
    chain.sort((x, y) => x.thresholdMs - y.thresholdMs);
  }

  for (const [tenantId, chain] of byTenant) {
    if (chain.length === 0) continue;

    // Janela mínima de elegibilidade = menor threshold da cadeia
    const minThresholdMs = chain[0].thresholdMs;
    const cutoff = new Date(Date.now() - minThresholdMs);

    // Pra feedback de "evaluated" (total de leads do tenant)
    const allLeads = await db
      .select({ id: lead.id })
      .from(lead)
      .where(eq(lead.tenantId, tenantId));
    evaluated += allLeads.length;

    // Leads candidatos: outgoing > incoming, outgoing <= cutoff, não grupo
    const leads = await db
      .select({
        leadId: lead.id,
        lastIncomingAt: crmConversation.lastIncomingAt,
        lastOutgoingAt: crmConversation.lastOutgoingAt,
      })
      .from(lead)
      .innerJoin(crmConversation, eq(crmConversation.id, lead.crmConversationId))
      .where(
        and(
          eq(lead.tenantId, tenantId),
          eq(crmConversation.isGroup, false),
          isNotNull(crmConversation.lastOutgoingAt),
          lte(crmConversation.lastOutgoingAt, cutoff),
          or(
            isNull(crmConversation.lastIncomingAt),
            gt(crmConversation.lastOutgoingAt, crmConversation.lastIncomingAt)
          )!
        )
      );
    eligible += leads.length;

    const autoIds = chain.map((c) => c.auto.id);

    // Cache de step0 por automationId (evita re-query)
    const step0ByAutoId = new Map<string, typeof automationStep.$inferSelect>();
    for (const { auto: a } of chain) {
      const [s] = await db
        .select()
        .from(automationStep)
        .where(eq(automationStep.automationId, a.id))
        .orderBy(asc(automationStep.order))
        .limit(1);
      if (s) step0ByAutoId.set(a.id, s);
    }

    for (const l of leads) {
      // Ciclo = período desde o último OUTGOING do operador. Operador manda
      // nova msg → lastOutgoingAt atualiza → logs antigos caem fora do filtro
      // → cadeia reinicia. (Runner não atualiza lastOutgoingAt, só operador.)
      const logConds = [
        inArray(automationLog.automationId, autoIds),
        eq(automationLog.leadId, l.leadId),
      ];
      if (l.lastOutgoingAt) {
        logConds.push(gt(automationLog.createdAt, l.lastOutgoingAt));
      }
      const logsInCycleRaw = await db
        .select({
          id: automationLog.id,
          automationId: automationLog.automationId,
          status: automationLog.status,
          executedAt: automationLog.executedAt,
          createdAt: automationLog.createdAt,
        })
        .from(automationLog)
        .where(and(...logConds));

      // Backoff: logs `failed`/`skipped` mais antigos que FAILED_BACKOFF_MS são
      // PURGADOS — permitem retry automático no próximo tick (ex: depois de
      // bug fix em provider). Logs recentes permanecem e bloqueiam o retry pra
      // evitar loop tight em erro permanente. Purga (vs. ignorar) evita que o
      // mapa logByAutoId fique com log "fantasma" que confundiria a chain logic
      // (prev.status checks).
      const FAILED_BACKOFF_MS = 5 * 60 * 1000;
      const now = Date.now();
      const toPurge: string[] = [];
      const logsInCycle = logsInCycleRaw.filter((lg) => {
        if (lg.status !== "failed" && lg.status !== "skipped") return true;
        const ts = lg.executedAt ?? lg.createdAt;
        if (ts && now - ts.getTime() >= FAILED_BACKOFF_MS) {
          toPurge.push(lg.id);
          return false;
        }
        return true;
      });
      if (toPurge.length > 0) {
        await db.delete(automationLog).where(inArray(automationLog.id, toPurge));
      }
      const logByAutoId = new Map(logsInCycle.map((lg) => [lg.automationId, lg]));

      // Percorre a cadeia; agenda no máximo 1 step por lead por tick.
      // Thresholds são INCREMENTAIS: step 1 espera `threshold1` desde lastOutgoing,
      // step 2 espera `threshold2` desde o `executedAt` do step 1, etc.
      for (let i = 0; i < chain.length; i++) {
        const { auto: a, thresholdMs } = chain[i];
        const existing = logByAutoId.get(a.id);
        if (existing) continue; // step já disparou neste ciclo (pending/processing/sent ou failed recente)

        // Determina "âncora" de tempo:
        //   - step 0: lastOutgoingAt (momento que operador parou de responder)
        //   - step N>0: executedAt do step anterior (momento que ele disparou)
        let anchor: Date | null;
        if (i === 0) {
          anchor = l.lastOutgoingAt ?? null;
        } else {
          const prev = logByAutoId.get(chain[i - 1].auto.id);
          if (!prev || prev.status !== "sent" || !prev.executedAt) {
            break; // step anterior não disparou com sucesso → cadeia bloqueada
          }
          anchor = prev.executedAt;
        }

        if (!anchor || anchor > new Date(Date.now() - thresholdMs)) {
          break; // tempo incremental ainda não bateu
        }

        // Respeita janela de horário (se configurada) — fora da janela, cadeia
        // pausa e retoma no próximo tick que cair dentro do horário.
        const cfg = (a.triggerConfig as TriggerConfig) ?? {};
        if (!isInSendWindow(cfg.sendWindow, new Date())) {
          break;
        }

        const step0 = step0ByAutoId.get(a.id);
        if (!step0) break; // automation sem steps — cadeia para aqui

        await db.insert(automationLog).values({
          automationId: a.id,
          leadId: l.leadId,
          stepId: step0.id,
          triggerType: a.triggerType,
          status: "pending",
          scheduledAt: new Date(),
          dryRun: isDryRun(),
        });
        scheduled++;
        break; // só 1 step por lead por tick
      }
    }
  }

  return { scheduled, evaluated, eligible };
}

// ─────────────────────────────────────────────────────────
// Processador
// ─────────────────────────────────────────────────────────

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function processPendingAutomations(
  limit = 50
): Promise<ProcessResult> {
  const now = new Date();
  // Não joinamos com automation_step aqui — queremos sempre a versão ATUAL (live)
  // do step em tempo de envio, mesmo que o stepId do log aponte pra um step que
  // foi deletado/recriado durante edições.
  const pending = await db
    .select({
      log: automationLog,
      automation: automation,
    })
    .from(automationLog)
    .innerJoin(automation, eq(automation.id, automationLog.automationId))
    .where(
      and(
        eq(automationLog.status, "pending"),
        lte(automationLog.scheduledAt, now)
      )
    )
    .orderBy(asc(automationLog.scheduledAt))
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of pending) {
    const { log, automation: auto } = row;

    // CLAIM ATÔMICO — previne processamento duplicado quando webhook inline
    // e ticker processam a mesma fila. O UPDATE só casa se status ainda é
    // 'pending'; se outro processo já virou pra 'processing'/'sent', ficamos
    // com 0 rows e pulamos. Usa status intermediário pra não marcar sent
    // prematuramente (caso dê erro depois).
    const claimed = await db
      .update(automationLog)
      .set({ status: "processing" })
      .where(
        and(eq(automationLog.id, log.id), eq(automationLog.status, "pending"))
      )
      .returning({ id: automationLog.id });
    if (claimed.length === 0) {
      continue; // outro processo pegou primeiro
    }

    // Resolve o step ATUAL da automação (o mais antigo por order — welcome/follow-up tem só 1)
    // Assim sempre usamos a versão LIVE editada no painel, não a snapshot do momento do schedule.
    const [step] = await db
      .select()
      .from(automationStep)
      .where(eq(automationStep.automationId, auto.id))
      .orderBy(asc(automationStep.order))
      .limit(1);

    if (!step) {
      await db
        .update(automationLog)
        .set({ status: "skipped", executedAt: new Date(), error: "automation sem steps atualmente" })
        .where(eq(automationLog.id, log.id));
      skipped++;
      continue;
    }

    try {
      if (!log.leadId) {
        await db
          .update(automationLog)
          .set({ status: "skipped", executedAt: new Date(), error: "no lead" })
          .where(eq(automationLog.id, log.id));
        skipped++;
        continue;
      }

      // Busca dados do lead + conversation
      const [leadRow] = await db
        .select({
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          convId: lead.crmConversationId,
          contactJid: crmConversation.contactJid,
          isGroup: crmConversation.isGroup,
        })
        .from(lead)
        .leftJoin(crmConversation, eq(crmConversation.id, lead.crmConversationId))
        .where(eq(lead.id, log.leadId))
        .limit(1);

      if (!leadRow || !leadRow.phone) {
        await db
          .update(automationLog)
          .set({ status: "failed", executedAt: new Date(), error: "lead not found" })
          .where(eq(automationLog.id, log.id));
        failed++;
        continue;
      }

      // Defesa em profundidade: pular grupos
      if (leadRow.isGroup === true) {
        await db
          .update(automationLog)
          .set({ status: "skipped", executedAt: new Date(), error: "conversation is group" })
          .where(eq(automationLog.id, log.id));
        skipped++;
        continue;
      }

      // Tipo `wait` — só marca como sent e passa
      if (step.type === "wait") {
        await db
          .update(automationLog)
          .set({ status: "sent", executedAt: new Date() })
          .where(eq(automationLog.id, log.id));
        sent++;
        continue;
      }

      if (step.type === "send_whatsapp") {
        const cfg = (step.config as StepConfig) ?? {};
        const tpl = cfg.message ?? "";
        const rendered = renderTemplate(tpl, {
          nome: leadRow.name ?? "",
          phone: leadRow.phone,
        });

        // Um log é "dry" se o processo atual está em DRY_RUN OU se o log foi
        // inserido por outro processo que estava em dry-run (flag gravada na
        // linha). Isso isola totalmente testes de execuções reais.
        const logIsDry = isDryRun() || log.dryRun === true;

        const [wNum] = await db
          .select({
            instanceId: whatsappNumber.uazapiSession,
            token: whatsappNumber.uazapiToken,
          })
          .from(whatsappNumber)
          .where(
            and(
              eq(whatsappNumber.tenantId, auto.tenantId),
              eq(whatsappNumber.isActive, true)
            )
          )
          .limit(1);

        // Sem whatsapp_number ativo — em dry-run permitimos seguir (testar fluxo),
        // em prod falha porque não dá pra enviar.
        if (!wNum?.instanceId && !logIsDry) {
          await db
            .update(automationLog)
            .set({
              status: "failed",
              executedAt: new Date(),
              error: "no active whatsapp_number",
            })
            .where(eq(automationLog.id, log.id));
          failed++;
          continue;
        }

        let sendOk = true;
        let sendError: string | undefined;

        if (logIsDry) {
          console.log(
            `[AUTO DRY_RUN] tenant=${auto.tenantId} → ${leadRow.phone}: ${rendered.slice(0, 80)}${rendered.length > 80 ? "…" : ""}`
          );
        } else {
          // Prefere contactJid (formato completo do WhatsApp, incl. LIDs) sobre phone
          const target = leadRow.contactJid ?? leadRow.phone;
          const result = await sendText(
            wNum!.instanceId,
            wNum!.token || undefined,
            target,
            rendered
          );
          if (result.error) {
            sendOk = false;
            sendError = result.error;
          }
        }

        if (!sendOk) {
          await db
            .update(automationLog)
            .set({ status: "failed", executedAt: new Date(), error: sendError ?? "send failed" })
            .where(eq(automationLog.id, log.id));
          failed++;
          continue;
        }

        // Envio ok — gravar histórico no inbox + atualizar timestamps
        const timestamp = new Date();
        if (leadRow.convId) {
          await db.insert(crmMessage).values({
            conversationId: leadRow.convId,
            direction: "outgoing",
            content: rendered,
            mediaType: "text",
            status: "sent",
            timestamp,
          });
          // Welcome/broadcast/scheduled atualizam `lastOutgoingAt` — contam como
          // "EU respondi" e fazem o ciclo de follow-up começar. Já o follow-up
          // em si (lead_inactive) NÃO pode atualizar, senão cada disparo
          // reiniciaria o ciclo e entraria em loop infinito.
          const convUpdates: Record<string, Date> = {
            lastMessageAt: timestamp,
            updatedAt: timestamp,
          };
          if (auto.triggerType !== "lead_inactive") {
            convUpdates.lastOutgoingAt = timestamp;
          }
          await db
            .update(crmConversation)
            .set(convUpdates)
            .where(eq(crmConversation.id, leadRow.convId));
        }

        await db
          .update(automationLog)
          .set({ status: "sent", executedAt: timestamp })
          .where(eq(automationLog.id, log.id));
        sent++;
        continue;
      }

      // Tipo desconhecido
      await db
        .update(automationLog)
        .set({
          status: "skipped",
          executedAt: new Date(),
          error: `unknown step type: ${step.type}`,
        })
        .where(eq(automationLog.id, log.id));
      skipped++;
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(automationLog)
        .set({ status: "failed", executedAt: new Date(), error: msg })
        .where(eq(automationLog.id, log.id));
    }
  }

  return { processed: pending.length, sent, failed, skipped };
}

// ─────────────────────────────────────────────────────────
// AUDIENCE FILTER — resolve quais leads receberão a automação
// ─────────────────────────────────────────────────────────

export interface AudienceFilter {
  pipelineId?: string;
  stageIds?: string[];
  tagIds?: string[];
  createdAfter?: string; // ISO timestamp
  createdBefore?: string;
  inactiveMinDays?: number; // leads que não enviaram incoming há X dias
  onlyNotReplied?: boolean; // true: só quem operator respondeu e lead não retornou
}

/**
 * Retorna IDs de leads do tenant que casam com o filtro.
 * SEMPRE exclui conversations de grupo.
 */
export async function resolveAudience(
  tenantId: string,
  filter: AudienceFilter | null | undefined
): Promise<string[]> {
  const conds = [
    eq(lead.tenantId, tenantId),
    // Conversation não pode ser grupo
    or(isNull(lead.crmConversationId), eq(crmConversation.isGroup, false))!,
  ];

  const f = filter ?? {};

  if (f.stageIds?.length) {
    conds.push(inArray(lead.stageId, f.stageIds));
  }

  if (f.createdAfter) {
    conds.push(gte(lead.createdAt, new Date(f.createdAfter)));
  }
  if (f.createdBefore) {
    conds.push(lte(lead.createdAt, new Date(f.createdBefore)));
  }

  if (f.inactiveMinDays !== undefined && f.inactiveMinDays > 0) {
    const cutoff = new Date(Date.now() - f.inactiveMinDays * 24 * 60 * 60 * 1000);
    // lastIncomingAt < cutoff OR lastIncomingAt IS NULL (lead nunca respondeu)
    conds.push(
      or(
        isNull(crmConversation.lastIncomingAt),
        lte(crmConversation.lastIncomingAt, cutoff)
      )!
    );
  }

  if (f.onlyNotReplied) {
    // operator/automation respondeu por último, lead ainda não voltou
    conds.push(
      and(
        isNotNull(crmConversation.lastOutgoingAt),
        or(
          isNull(crmConversation.lastIncomingAt),
          gt(crmConversation.lastOutgoingAt, crmConversation.lastIncomingAt)
        )!
      )!
    );
  }

  const baseQuery = db
    .selectDistinct({ id: lead.id })
    .from(lead)
    .leftJoin(crmConversation, eq(crmConversation.id, lead.crmConversationId));

  // Se tem filtro por tag, precisa INNER JOIN
  if (f.tagIds?.length) {
    const rowsWithTag = await baseQuery
      .innerJoin(leadTagAssignment, eq(leadTagAssignment.leadId, lead.id))
      .where(and(...conds, inArray(leadTagAssignment.tagId, f.tagIds)));
    return rowsWithTag.map((r) => r.id);
  }

  const rows = await baseQuery.where(and(...conds));
  return rows.map((r) => r.id);
}

// ─────────────────────────────────────────────────────────
// BROADCAST — envia pra todo mundo que casa com o filtro (one-shot)
// ─────────────────────────────────────────────────────────

/**
 * Dispara manual_broadcast imediatamente: resolve audiência + agenda todos steps.
 * Usado pelo botão "Enviar agora" na UI.
 */
export async function triggerBroadcast(params: {
  automationId: string;
}): Promise<{ targeted: number; scheduled: number }> {
  const [auto] = await db
    .select()
    .from(automation)
    .where(eq(automation.id, params.automationId))
    .limit(1);

  if (!auto || !auto.isActive) return { targeted: 0, scheduled: 0 };

  const leadIds = await resolveAudience(
    auto.tenantId,
    auto.audienceFilter as AudienceFilter
  );

  const steps = await db
    .select()
    .from(automationStep)
    .where(eq(automationStep.automationId, auto.id))
    .orderBy(asc(automationStep.order));

  if (!steps.length) return { targeted: leadIds.length, scheduled: 0 };

  let scheduled = 0;
  for (const leadId of leadIds) {
    let scheduledAt = new Date();
    for (const step of steps) {
      const cfg = (step.config as StepConfig) ?? {};
      scheduledAt = new Date(scheduledAt.getTime() + computeDelayMs(cfg));
      await db.insert(automationLog).values({
        automationId: auto.id,
        leadId,
        stepId: step.id,
        triggerType: auto.triggerType,
        status: "pending",
        scheduledAt,
        dryRun: isDryRun(),
      });
      scheduled++;
    }
  }

  await db
    .update(automation)
    .set({ lastFiredAt: new Date(), updatedAt: new Date() })
    .where(eq(automation.id, auto.id));

  return { targeted: leadIds.length, scheduled };
}

// ─────────────────────────────────────────────────────────
// SCHEDULED — cron dispara automações agendadas (one-shot e recorrentes)
// ─────────────────────────────────────────────────────────

export interface ScheduledOnceConfig {
  runAt: string; // ISO timestamp
}

export type RecurringFrequency = "daily" | "weekly" | "monthly";

export interface RecurringConfig {
  frequency: RecurringFrequency;
  hour: number; // 0-23
  minute: number; // 0-59
  weekday?: number; // 0-6 (0=domingo), só pra weekly
  day?: number; // 1-31, só pra monthly
  timezone?: string; // não usado ainda — horário em UTC por default
}

/**
 * Decide se uma recorrência deve rodar AGORA:
 *  - Compara now com o slot configurado (hora/minuto/dia da semana/dia do mês)
 *  - Não roda se lastFiredAt está dentro do mesmo slot
 */
function shouldRunRecurring(
  cfg: RecurringConfig,
  now: Date,
  lastFiredAt: Date | null
): boolean {
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();

  // Slot definido como "o minuto cheio": runner deve rodar dentro da mesma janela de 60min
  if (h !== cfg.hour) return false;
  // Tolerância: rodar se minuto atual >= minuto config (pra cron que roda a cada 5min não perder)
  if (m < cfg.minute) return false;

  if (cfg.frequency === "weekly" && cfg.weekday !== undefined) {
    if (now.getUTCDay() !== cfg.weekday) return false;
  }
  if (cfg.frequency === "monthly" && cfg.day !== undefined) {
    if (now.getUTCDate() !== cfg.day) return false;
  }

  // Dedup: já rodou nas últimas 23h? (evita double-fire em retries)
  if (lastFiredAt) {
    const sinceLast = now.getTime() - lastFiredAt.getTime();
    if (sinceLast < 23 * 60 * 60 * 1000) return false;
  }

  return true;
}

/**
 * Processa automações scheduled_once e scheduled_recurring que devem disparar agora.
 * Chamado pelo cron.
 */
export async function runScheduledAutomations(params: {
  tenantId?: string;
}): Promise<{ fired: number; totalScheduled: number }> {
  const now = new Date();

  const whereAuto = params.tenantId
    ? and(
        eq(automation.isActive, true),
        eq(automation.tenantId, params.tenantId),
        inArray(automation.triggerType, ["scheduled_once", "scheduled_recurring"]),
        nonDryAutoFilter()
      )
    : and(
        eq(automation.isActive, true),
        inArray(automation.triggerType, ["scheduled_once", "scheduled_recurring"]),
        nonDryAutoFilter()
      );

  const autos = await db.select().from(automation).where(whereAuto);

  let fired = 0;
  let totalScheduled = 0;

  for (const auto of autos) {
    let shouldFire = false;

    if (auto.triggerType === "scheduled_once") {
      const cfg = (auto.triggerConfig as ScheduledOnceConfig | null) ?? null;
      if (!cfg?.runAt) continue;
      const runAt = new Date(cfg.runAt);
      if (runAt > now) continue; // ainda não é hora
      if (auto.lastFiredAt) continue; // já rodou
      shouldFire = true;
    }

    if (auto.triggerType === "scheduled_recurring") {
      const cfg = (auto.triggerConfig as RecurringConfig | null) ?? null;
      if (!cfg) continue;
      shouldFire = shouldRunRecurring(cfg, now, auto.lastFiredAt);
    }

    if (!shouldFire) continue;

    // Resolve audiência + agenda steps pra cada lead
    const leadIds = await resolveAudience(
      auto.tenantId,
      auto.audienceFilter as AudienceFilter
    );

    const steps = await db
      .select()
      .from(automationStep)
      .where(eq(automationStep.automationId, auto.id))
      .orderBy(asc(automationStep.order));

    if (!steps.length) {
      // Marca como firado mesmo assim pra não ficar tentando
      await db
        .update(automation)
        .set({ lastFiredAt: now, updatedAt: now })
        .where(eq(automation.id, auto.id));
      continue;
    }

    for (const leadId of leadIds) {
      let scheduledAt = new Date(now);
      for (const step of steps) {
        const cfg = (step.config as StepConfig) ?? {};
        scheduledAt = new Date(scheduledAt.getTime() + computeDelayMs(cfg));
        await db.insert(automationLog).values({
          automationId: auto.id,
          leadId,
          stepId: step.id,
          triggerType: auto.triggerType,
          status: "pending",
          scheduledAt,
          dryRun: isDryRun(),
        });
        totalScheduled++;
      }
    }

    await db
      .update(automation)
      .set({ lastFiredAt: now, updatedAt: now })
      .where(eq(automation.id, auto.id));

    fired++;
  }

  return { fired, totalScheduled };
}
