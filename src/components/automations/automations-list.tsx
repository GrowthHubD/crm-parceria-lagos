"use client";

import { useState } from "react";
import { Plus, Zap, Pause, Play, Trash2, ChevronRight, Clock, MessageSquare, Mail, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AutomationEditor } from "./automation-editor";

interface Step {
  id: string;
  order: number;
  type: string;
  config: Record<string, unknown>;
}

interface Automation {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
  isActive: boolean;
  steps: Step[];
  createdAt: string;
}

interface Stage {
  id: string;
  name: string;
}

interface AutomationsListProps {
  initialAutomations: Automation[];
  stages: Stage[];
  canEdit: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  stage_enter: "Ao entrar em etapa",
  tag_added: "Ao adicionar tag",
  manual: "Disparo manual",
  manual_broadcast: "Broadcast",
  first_message: "Boas-vindas",
  lead_inactive: "Follow-up de inatividade",
  scheduled_once: "Agendada única",
  scheduled_recurring: "Agendada recorrente",
};

const WEEKDAY_LABEL = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Formata a "minutagem" configurada no triggerConfig pro label do card. */
function formatTiming(triggerType: string, cfg: Record<string, unknown> | null): string | null {
  if (!cfg) return null;

  if (triggerType === "lead_inactive") {
    const m = (cfg.inactiveMinutes as number | undefined) ?? 0;
    const h = (cfg.inactiveHours as number | undefined) ?? 0;
    const d = (cfg.inactiveDays as number | undefined) ?? 0;
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}min`);
    if (parts.length === 0) return null;
    const win = cfg.sendWindow as { startHour?: number; endHour?: number } | undefined;
    const timing = `após ${parts.join(" ")}`;
    return win && typeof win.startHour === "number" && typeof win.endHour === "number"
      ? `${timing} · ${win.startHour}h–${win.endHour}h`
      : timing;
  }

  if (triggerType === "scheduled_once") {
    const runAt = cfg.runAt as string | undefined;
    if (!runAt) return null;
    const d = new Date(runAt);
    if (isNaN(d.getTime())) return null;
    return `em ${d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  }

  if (triggerType === "scheduled_recurring") {
    const freq = cfg.frequency as string | undefined;
    const hour = cfg.hour as number | undefined;
    const minute = cfg.minute as number | undefined;
    if (freq === undefined || hour === undefined) return null;
    const time = `${String(hour).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
    if (freq === "daily") return `diário às ${time}`;
    if (freq === "weekly") {
      const w = cfg.weekday as number | undefined;
      return `semanal (${w !== undefined ? WEEKDAY_LABEL[w] : "?"}) às ${time}`;
    }
    if (freq === "monthly") {
      const day = cfg.day as number | undefined;
      return `mensal (dia ${day ?? "?"}) às ${time}`;
    }
    return null;
  }

  return null;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  send_whatsapp: MessageSquare,
  wait: Clock,
  send_email: Mail,
};

export function AutomationsList({ initialAutomations, stages, canEdit }: AutomationsListProps) {
  const [automations, setAutomations] = useState(initialAutomations);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const handleToggle = async (id: string, currentActive: boolean) => {
    setAutomations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isActive: !currentActive } : a))
    );
    await fetch(`/api/automations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !currentActive }),
    });
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const res = await fetch(`/api/automations/${pendingDelete}`, { method: "DELETE" });
    if (res.ok) {
      setAutomations((prev) => prev.filter((a) => a.id !== pendingDelete));
      toast.success("Automação excluída");
    }
    setPendingDelete(null);
  };

  const handleSaved = (saved: Automation) => {
    setAutomations((prev) => {
      const exists = prev.find((a) => a.id === saved.id);
      if (exists) return prev.map((a) => (a.id === saved.id ? saved : a));
      return [saved, ...prev];
    });
    setEditorOpen(false);
    setEditingId(null);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setEditorOpen(true);
  };

  const handleNew = () => {
    setEditingId(null);
    setEditorOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Automações</h1>
          <p className="text-muted mt-1">Sequências de follow-up automáticas via WhatsApp</p>
        </div>
        {canEdit && (
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Automação
          </button>
        )}
      </div>

      {automations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-surface rounded-xl border border-border">
          <Zap className="w-12 h-12 text-muted mb-4" />
          <h2 className="text-lg font-semibold text-foreground">Nenhuma automação</h2>
          <p className="text-muted text-sm mt-1 max-w-md text-center">
            Crie sua primeira automação para enviar follow-ups automáticos via WhatsApp.
          </p>
          {canEdit && (
            <button
              onClick={handleNew}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Criar Automação
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map((auto) => (
            <div
              key={auto.id}
              className="bg-surface border border-border rounded-xl p-4 hover:border-primary/30 transition-colors cursor-pointer group"
              onClick={() => handleEdit(auto.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                    auto.isActive ? "bg-primary/10" : "bg-surface-2"
                  )}>
                    <Zap className={cn("w-4 h-4", auto.isActive ? "text-primary" : "text-muted")} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{auto.name}</p>
                      <span className={cn(
                        "px-2 py-0.5 text-xs rounded-full font-medium",
                        auto.isActive ? "bg-success/10 text-success" : "bg-muted/10 text-muted"
                      )}>
                        {auto.isActive ? "Ativa" : "Inativa"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted">{TRIGGER_LABELS[auto.triggerType] ?? auto.triggerType}</span>
                      {(() => {
                        const timing = formatTiming(auto.triggerType, auto.triggerConfig);
                        return timing ? (
                          <>
                            <span className="text-xs text-muted">·</span>
                            <span className="text-xs text-primary font-medium">{timing}</span>
                          </>
                        ) : null;
                      })()}
                      <span className="text-xs text-muted">·</span>
                      <span className="text-xs text-muted">{auto.steps.length} etapa{auto.steps.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <>
                      <button
                        onClick={() => handleToggle(auto.id, auto.isActive)}
                        className="p-1.5 rounded text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
                        title={auto.isActive ? "Pausar" : "Ativar"}
                      >
                        {auto.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => setPendingDelete(auto.id)}
                        className="p-1.5 rounded text-muted hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted group-hover:text-foreground transition-colors" />
                </div>
              </div>

              {/* Steps preview */}
              {auto.steps.length > 0 && (
                <div className="flex items-center gap-1.5 mt-3 overflow-x-auto">
                  {auto.steps.map((step, i) => {
                    const Icon = STEP_ICONS[step.type] ?? Zap;
                    return (
                      <div key={step.id} className="flex items-center gap-1.5 shrink-0">
                        {i > 0 && <div className="w-4 h-px bg-border" />}
                        <div className="flex items-center gap-1 px-2 py-1 bg-surface-2 rounded text-xs text-muted">
                          <Icon className="w-3 h-3" />
                          <span>
                            {step.type === "wait"
                              ? `${(step.config as { delayMinutes?: number }).delayMinutes ?? 0}min`
                              : step.type === "send_whatsapp"
                                ? "WhatsApp"
                                : "Email"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editorOpen && (
        <AutomationEditor
          automationId={editingId}
          stages={stages}
          onClose={() => { setEditorOpen(false); setEditingId(null); }}
          onSaved={handleSaved}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Excluir automação"
        message="Tem certeza que deseja excluir esta automação? Os logs serão perdidos."
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
