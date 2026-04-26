"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Clock, Calendar, Repeat, Zap, Tag as TagIcon } from "lucide-react";

interface Stage {
  id: string;
  name: string;
}

interface Tag {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  stages: Stage[];
  tags: Tag[];
}

type Mode = "manual" | "once" | "daily" | "weekly" | "monthly";

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/**
 * Editor pra criar automações de:
 * - Enviar agora (manual_broadcast) — dispara na hora
 * - Agendar (scheduled_once) — envia em data/hora específica
 * - Recorrente (scheduled_recurring) — envia toda seg 10h, etc.
 *
 * Tudo com audienceFilter (stage/tag/data/inatividade).
 */
export function ScheduledAutomationEditor({ stages, tags }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [runAt, setRunAt] = useState(""); // datetime-local
  const [hour, setHour] = useState(10);
  const [minute, setMinute] = useState(0);
  const [weekday, setWeekday] = useState(1); // segunda
  const [monthDay, setMonthDay] = useState(1);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [inactiveMinDays, setInactiveMinDays] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setMessage("");
    setRunAt("");
    setStageIds([]);
    setTagIds([]);
    setInactiveMinDays("");
    setError(null);
  }

  function toggle<T extends string>(current: T[], value: T, setter: (v: T[]) => void) {
    setter(current.includes(value) ? current.filter((x) => x !== value) : [...current, value]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !message.trim()) {
      setError("Nome e mensagem são obrigatórios");
      return;
    }
    setError(null);
    setSubmitting(true);

    const audienceFilter: Record<string, unknown> = {};
    if (stageIds.length) audienceFilter.stageIds = stageIds;
    if (tagIds.length) audienceFilter.tagIds = tagIds;
    if (typeof inactiveMinDays === "number" && inactiveMinDays > 0) {
      audienceFilter.inactiveMinDays = inactiveMinDays;
    }

    let triggerType: string;
    let triggerConfig: Record<string, unknown> | null = null;

    if (mode === "manual") {
      triggerType = "manual_broadcast";
    } else if (mode === "once") {
      if (!runAt) {
        setError("Escolha uma data/hora");
        setSubmitting(false);
        return;
      }
      triggerType = "scheduled_once";
      triggerConfig = { runAt: new Date(runAt).toISOString() };
    } else {
      triggerType = "scheduled_recurring";
      triggerConfig = {
        frequency: mode,
        hour,
        minute,
        ...(mode === "weekly" ? { weekday } : {}),
        ...(mode === "monthly" ? { day: monthDay } : {}),
      };
    }

    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          triggerType,
          triggerConfig,
          audienceFilter: Object.keys(audienceFilter).length > 0 ? audienceFilter : null,
          steps: [
            { type: "send_whatsapp", config: { message: message.trim() } },
          ],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao criar");
        return;
      }

      // Se é "Enviar agora", dispara imediatamente
      if (mode === "manual" && data.automation?.id) {
        const bcastRes = await fetch(`/api/automations/${data.automation.id}/broadcast`, {
          method: "POST",
        });
        const bcastData = await bcastRes.json();
        if (!bcastRes.ok) {
          setError(bcastData.error ?? "Erro no broadcast");
          return;
        }
        alert(`Broadcast enviado: ${bcastData.sent} de ${bcastData.targeted} lead(s)`);
      }

      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90"
        >
          <Plus className="w-4 h-4" />
          Novo envio / agendamento
        </button>
      )}

      {open && (
        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-xl p-6 space-y-5"
        >
          <h3 className="font-semibold text-lg">Criar envio em massa ou agendamento</h3>

          {/* Modo */}
          <div>
            <label className="text-small text-muted block mb-2">Quando enviar</label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {([
                { m: "manual", label: "Agora", icon: Zap },
                { m: "once", label: "Data/hora", icon: Calendar },
                { m: "daily", label: "Todo dia", icon: Repeat },
                { m: "weekly", label: "Toda semana", icon: Repeat },
                { m: "monthly", label: "Todo mês", icon: Repeat },
              ] as const).map(({ m, label, icon: Icon }) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition ${
                    mode === m
                      ? "bg-primary/10 border-primary text-primary"
                      : "bg-surface-2 border-border text-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Config do modo */}
          {mode === "once" && (
            <div>
              <label className="text-small text-muted block mb-1">Data e hora</label>
              <input
                type="datetime-local"
                value={runAt}
                onChange={(e) => setRunAt(e.target.value)}
                className="px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground"
              />
            </div>
          )}

          {(mode === "daily" || mode === "weekly" || mode === "monthly") && (
            <div className="flex items-end gap-3 flex-wrap">
              {mode === "weekly" && (
                <div>
                  <label className="text-small text-muted block mb-1">Dia da semana</label>
                  <select
                    value={weekday}
                    onChange={(e) => setWeekday(Number(e.target.value))}
                    className="px-3 py-2 bg-surface-2 border border-border rounded-lg"
                  >
                    {WEEKDAY_LABELS.map((lbl, i) => (
                      <option key={i} value={i}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {mode === "monthly" && (
                <div>
                  <label className="text-small text-muted block mb-1">Dia do mês</label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={monthDay}
                    onChange={(e) => setMonthDay(Number(e.target.value))}
                    className="w-20 px-3 py-2 bg-surface-2 border border-border rounded-lg"
                  />
                </div>
              )}
              <div>
                <label className="text-small text-muted block mb-1">Hora (UTC)</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value))}
                    className="w-16 px-3 py-2 bg-surface-2 border border-border rounded-lg"
                  />
                  <span className="text-muted">:</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(e) => setMinute(Number(e.target.value))}
                    className="w-16 px-3 py-2 bg-surface-2 border border-border rounded-lg"
                  />
                </div>
                <p className="text-xs text-muted/70 mt-1">Use UTC. Ex: 13h UTC = 10h BR.</p>
              </div>
            </div>
          )}

          {/* Nome + mensagem */}
          <div>
            <label className="text-small text-muted block mb-1">Nome interno *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Lembrete semanal"
              className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground"
            />
          </div>

          <div>
            <label className="text-small text-muted block mb-1">Mensagem *</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Olá {{nome}}, ..."
              className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground"
            />
            <p className="text-xs text-muted/70 mt-1">
              Use <code className="font-mono">{"{{nome}}"}</code> pra inserir o nome. Grupos são excluídos automaticamente.
            </p>
          </div>

          {/* Filtros de audiência */}
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-small font-medium text-foreground">Quem recebe (opcional)</p>
            <p className="text-xs text-muted/70">
              Sem filtro = envia pra todos os leads do tenant (exceto grupos).
            </p>

            {stages.length > 0 && (
              <div>
                <label className="text-small text-muted block mb-1">Etapa do funil</label>
                <div className="flex flex-wrap gap-1.5">
                  {stages.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(stageIds, s.id, setStageIds)}
                      className={`px-2 py-1 rounded-full text-xs border ${
                        stageIds.includes(s.id)
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-surface-2 border-border text-muted"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <div>
                <label className="text-small text-muted block mb-1">
                  <TagIcon className="w-3.5 h-3.5 inline mr-1" />
                  Tags
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggle(tagIds, t.id, setTagIds)}
                      className={`px-2 py-1 rounded-full text-xs border ${
                        tagIds.includes(t.id)
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-surface-2 border-border text-muted"
                      }`}
                      style={tagIds.includes(t.id) && t.color ? { borderColor: t.color } : undefined}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-small text-muted block mb-1">
                <Clock className="w-3.5 h-3.5 inline mr-1" />
                Sem responder há N dias (opcional)
              </label>
              <input
                type="number"
                min={0}
                placeholder="Ex: 30"
                value={inactiveMinDays}
                onChange={(e) => setInactiveMinDays(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-24 px-3 py-2 bg-surface-2 border border-border rounded-lg"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "manual" ? "Enviar agora" : "Criar agendamento"}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className="px-4 py-2 text-muted hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
