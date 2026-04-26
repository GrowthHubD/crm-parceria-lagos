"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Loader2,
  CheckCircle2,
  Pause,
  Play,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { HistoryModal } from "./history-modal";

interface ExistingStep {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface FollowUp {
  id: string;
  name: string;
  description: string | null;
  triggerConfig: Record<string, unknown> | null;
  isActive: boolean;
  steps: ExistingStep[];
}

interface Props {
  followUps: FollowUp[];
}

type Unit = "minutes" | "hours" | "days";

function configToDelay(cfg: Record<string, unknown> | null): { value: number; unit: Unit } {
  const m = (cfg?.inactiveMinutes as number | undefined) ?? 0;
  const h = (cfg?.inactiveHours as number | undefined) ?? 0;
  const d = (cfg?.inactiveDays as number | undefined) ?? 0;
  if (d > 0) return { value: d, unit: "days" };
  if (h > 0) return { value: h, unit: "hours" };
  if (m > 0) return { value: m, unit: "minutes" };
  return { value: 3, unit: "days" };
}

function delayToConfig(value: number, unit: Unit): Record<string, number> {
  if (unit === "minutes") return { inactiveMinutes: value };
  if (unit === "hours") return { inactiveHours: value };
  return { inactiveDays: value };
}

interface SendWindowState {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

function readSendWindow(cfg: Record<string, unknown> | null): SendWindowState {
  const w = cfg?.sendWindow as { startHour?: number; endHour?: number } | undefined;
  if (w && typeof w.startHour === "number" && typeof w.endHour === "number") {
    return { enabled: true, startHour: w.startHour, endHour: w.endHour };
  }
  return { enabled: false, startHour: 9, endHour: 18 };
}

function buildTriggerConfig(
  value: number,
  unit: Unit,
  win: SendWindowState
): Record<string, unknown> {
  const base = delayToConfig(value, unit) as Record<string, unknown>;
  if (win.enabled) {
    base.sendWindow = {
      startHour: win.startHour,
      endHour: win.endHour,
      timezone: "America/Sao_Paulo",
    };
  }
  return base;
}

const UNIT_LABEL: Record<Unit, string> = {
  minutes: "minutos",
  hours: "horas",
  days: "dias",
};

const DEFAULT_MSG = "Oi {{nome}}, tudo bem?\n\nNotei que faz um tempo que não conversamos. Ainda posso te ajudar?";

export function FollowUpList({ followUps }: Props) {
  return (
    <div className="space-y-3">
      {followUps.map((f) => (
        <FollowUpCard key={f.id} followUp={f} />
      ))}
      <NewFollowUpCard />
    </div>
  );
}

function FollowUpCard({ followUp }: { followUp: FollowUp }) {
  const router = useRouter();
  const initialDelay = configToDelay(followUp.triggerConfig);
  const initialMsg = (followUp.steps?.[0]?.config?.message as string | undefined) ?? DEFAULT_MSG;

  const [name, setName] = useState(followUp.name);
  const [description, setDescription] = useState(followUp.description ?? "");
  const [delayValue, setDelayValue] = useState(initialDelay.value);
  const [delayUnit, setDelayUnit] = useState<Unit>(initialDelay.unit);
  const [message, setMessage] = useState(initialMsg);
  const [sendWindow, setSendWindow] = useState<SendWindowState>(
    readSendWindow(followUp.triggerConfig)
  );
  const [loading, setLoading] = useState<string | null>(null);

  async function save() {
    setLoading("save");
    try {
      await fetch(`/api/automations/${followUp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Follow-up",
          description: description.trim() || null,
          triggerConfig: buildTriggerConfig(delayValue, delayUnit, sendWindow),
          steps: [{ type: "send_whatsapp", config: { message } }],
        }),
      });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function toggle() {
    setLoading("toggle");
    try {
      await fetch(`/api/automations/${followUp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !followUp.isActive }),
      });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function remove() {
    if (!confirm(`Excluir follow-up "${followUp.name}" permanentemente?`)) return;
    setLoading("delete");
    try {
      await fetch(`/api/automations/${followUp.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function runNow() {
    if (!confirm(`Disparar "${followUp.name}" AGORA pra todos os leads elegíveis? (Leads inativos que já passaram do limite de tempo vão receber a mensagem)`)) return;
    setLoading("run");
    try {
      const res = await fetch(`/api/automations/${followUp.id}/run`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        if (data.sent > 0) {
          alert(`✓ ${data.sent} mensagem(ns) enviada(s). Avaliados: ${data.evaluated ?? "?"} leads, elegíveis: ${data.eligible ?? "?"}.`);
        } else {
          alert(
            `Nenhum lead elegível pra disparo.\n\n` +
            `Avaliados: ${data.evaluated ?? "?"} leads do tenant\n` +
            `Elegíveis: ${data.eligible ?? 0}\n\n` +
            `Critérios do follow-up:\n` +
            `• VOCÊ precisa ter respondido por último (last_outgoing > last_incoming)\n` +
            `• A última resposta precisa ter passado do tempo configurado\n` +
            `• O lead não pode ter recebido este mesmo follow-up antes\n` +
            `• A conversa não pode ser grupo`
          );
        }
      } else {
        alert(`Erro: ${data.error ?? "desconhecido"}`);
      }
    } catch (e) {
      alert(`Falha: ${e instanceof Error ? e.message : "rede"}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Clock className="w-5 h-5 text-primary shrink-0" />
          <h3 className="font-semibold truncate">{name || "Follow-up"}</h3>
        </div>
        {followUp.isActive ? (
          <span className="flex items-center gap-1 text-xs text-success shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" /> Ativo
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted shrink-0">
            <Pause className="w-3.5 h-3.5" /> Pausado
          </span>
        )}
      </div>

      <div>
        <label className="text-small text-muted block mb-1 font-medium">Nome</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-foreground"
          placeholder="Nome do follow-up"
        />
      </div>

      <div>
        <label className="text-small text-muted block mb-1">Descrição</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Pra sua equipe lembrar do propósito"
          className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-xs text-muted"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-small text-muted">Disparar após</span>
        <input
          type="number"
          min={1}
          value={delayValue}
          onChange={(e) => setDelayValue(parseInt(e.target.value) || 1)}
          className="w-20 px-2 py-1.5 bg-surface-2 border border-border rounded-lg text-sm"
        />
        <select
          value={delayUnit}
          onChange={(e) => setDelayUnit(e.target.value as Unit)}
          className="px-2 py-1.5 bg-surface-2 border border-border rounded-lg text-sm"
        >
          <option value="minutes">minutos</option>
          <option value="hours">horas</option>
          <option value="days">dias</option>
        </select>
        <span className="text-small text-muted">sem resposta do contato</span>
      </div>
      <p className="text-xs text-muted/70">
        Dispara apenas se VOCÊ respondeu por último e o contato não retornou. ⚠ Não dispara em grupos.
      </p>

      <WindowEditor value={sendWindow} onChange={setSendWindow} />

      <div>
        <label className="text-small text-muted block mb-1">Mensagem</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-foreground"
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={save}
          disabled={loading === "save"}
          className="flex-1 min-w-[140px] flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 text-sm"
        >
          {loading === "save" && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar alterações
        </button>
        {followUp.isActive && (
          <button
            onClick={runNow}
            disabled={loading === "run"}
            className="flex items-center gap-1.5 px-3 py-2 border border-primary/50 text-primary rounded-lg text-sm hover:bg-primary/10 disabled:opacity-50"
            title="Disparar manualmente agora"
          >
            {loading === "run" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            Disparar agora
          </button>
        )}
        <HistoryModal automationId={followUp.id} label={followUp.name} />
        <button
          onClick={toggle}
          disabled={loading === "toggle"}
          className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm text-muted hover:text-foreground disabled:opacity-50"
        >
          {loading === "toggle" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : followUp.isActive ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {followUp.isActive ? "Desativar" : "Reativar"}
        </button>
        <button
          onClick={remove}
          disabled={loading === "delete"}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-muted hover:text-destructive hover:border-destructive/50 rounded-lg text-sm disabled:opacity-50"
          title="Excluir follow-up"
        >
          {loading === "delete" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}

function NewFollowUpCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [delayValue, setDelayValue] = useState(3);
  const [delayUnit, setDelayUnit] = useState<Unit>("days");
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [sendWindow, setSendWindow] = useState<SendWindowState>({
    enabled: false,
    startHour: 9,
    endHour: 18,
  });
  const [loading, setLoading] = useState(false);

  async function create() {
    if (!name.trim() || !message.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          triggerType: "lead_inactive",
          triggerConfig: buildTriggerConfig(delayValue, delayUnit, sendWindow),
          steps: [{ type: "send_whatsapp", config: { message } }],
        }),
      });
      if (res.ok) {
        setOpen(false);
        setName("");
        setDescription("");
        setDelayValue(3);
        setDelayUnit("days");
        setMessage(DEFAULT_MSG);
        setSendWindow({ enabled: false, startHour: 9, endHour: 18 });
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-border rounded-xl text-sm text-muted hover:text-foreground hover:border-primary/50"
      >
        <Plus className="w-4 h-4" />
        Adicionar novo follow-up
      </button>
    );
  }

  return (
    <div className="bg-surface border border-primary/50 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Novo follow-up</h3>
      </div>

      <div>
        <label className="text-small text-muted block mb-1 font-medium">Nome *</label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Lembrete 1h sem resposta"
          className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-foreground"
        />
      </div>

      <div>
        <label className="text-small text-muted block mb-1">Descrição (opcional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Pra sua equipe lembrar do propósito desse follow-up"
          className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-xs text-muted"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-small text-muted">Disparar após</span>
        <input
          type="number"
          min={1}
          value={delayValue}
          onChange={(e) => setDelayValue(parseInt(e.target.value) || 1)}
          className="w-20 px-2 py-1.5 bg-surface-2 border border-border rounded-lg text-sm"
        />
        <select
          value={delayUnit}
          onChange={(e) => setDelayUnit(e.target.value as Unit)}
          className="px-2 py-1.5 bg-surface-2 border border-border rounded-lg text-sm"
        >
          <option value="minutes">minutos</option>
          <option value="hours">horas</option>
          <option value="days">dias</option>
        </select>
        <span className="text-small text-muted">sem resposta</span>
      </div>

      <WindowEditor value={sendWindow} onChange={setSendWindow} />

      <div>
        <label className="text-small text-muted block mb-1">Mensagem *</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-foreground"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={create}
          disabled={loading || !name.trim() || !message.trim()}
          className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 text-sm"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Criar follow-up
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-2 text-muted hover:text-foreground text-sm"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function WindowEditor({
  value,
  onChange,
}: {
  value: SendWindowState;
  onChange: (v: SendWindowState) => void;
}) {
  const crossesMidnight = value.enabled && value.startHour > value.endHour;
  const emptyRange = value.enabled && value.startHour === value.endHour;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-small text-muted cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className="w-4 h-4 accent-primary"
        />
        <span>Disparar apenas em determinado horário</span>
      </label>

      {value.enabled && (
        <div className="flex items-center gap-2 flex-wrap pl-6">
          <span className="text-small text-muted">De</span>
          <input
            type="number"
            min={0}
            max={23}
            value={value.startHour}
            onChange={(e) => {
              const n = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
              onChange({ ...value, startHour: n });
            }}
            className="w-16 px-2 py-1.5 bg-surface-2 border border-border rounded-lg text-sm text-center"
          />
          <span className="text-small text-muted">h até</span>
          <input
            type="number"
            min={0}
            max={23}
            value={value.endHour}
            onChange={(e) => {
              const n = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
              onChange({ ...value, endHour: n });
            }}
            className="w-16 px-2 py-1.5 bg-surface-2 border border-border rounded-lg text-sm text-center"
          />
          <span className="text-small text-muted">h (horário de Brasília)</span>
        </div>
      )}

      {value.enabled && !emptyRange && (
        <p className="text-xs text-muted/70 pl-6">
          {crossesMidnight
            ? `Dispara entre ${value.startHour}h e ${value.endHour}h (atravessa a meia-noite).`
            : `Dispara das ${value.startHour}h até ${value.endHour}h. Fora da janela, aguarda a próxima abertura.`}
        </p>
      )}
      {emptyRange && (
        <p className="text-xs text-destructive pl-6">
          Início e fim iguais — janela vazia. Ajuste os horários.
        </p>
      )}
    </div>
  );
}

// Placeholder quando não há nenhum follow-up ainda
export function EmptyFollowUpsNotice() {
  return (
    <p className="text-xs text-muted/70">
      Ex: &quot;30 min sem resposta&quot; → lembrete rápido, &quot;3 dias&quot; → re-engajamento suave.
    </p>
  );
}
