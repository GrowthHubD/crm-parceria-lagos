"use client";

/**
 * Modal compacto pra criar uma tarefa rápida vinculada a um lead — invocado
 * dentro da conversa do CRM (quando linkedLead existe). Pré-preenche leadId,
 * assigna ao próprio user logado, primeira coluna do kanban como destino.
 *
 * Reusa POST /api/kanban/tasks (já valida tenant, multi-tenant safe).
 */

import { useEffect, useState } from "react";
import { Loader2, X, CalendarDays } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface QuickTaskModalProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  currentUserId: string;
  onCreated?: () => void;
}

interface KanbanColumn {
  id: string;
  name: string;
  order: number;
}

const PRIORITIES: Array<{ value: "low" | "medium" | "high" | "urgent"; label: string; color: string }> = [
  { value: "low", label: "Baixa", color: "border-success/40" },
  { value: "medium", label: "Média", color: "border-warning/40" },
  { value: "high", label: "Alta", color: "border-error/40" },
  { value: "urgent", label: "Urgente", color: "border-error" },
];

/** Atalhos rápidos pra dueDate. Retornam ISO datetime. */
function dueIn(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  // Local format pra input datetime-local: YYYY-MM-DDTHH:mm
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function QuickTaskModal({ open, onClose, leadId, leadName, currentUserId, onCreated }: QuickTaskModalProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [columnId, setColumnId] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  // Carrega colunas do kanban (1ª por ordem é o destino default da nova tarefa)
  useEffect(() => {
    if (!open) return;
    fetch("/api/kanban", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { columns: KanbanColumn[] }) => {
        const sorted = [...(data.columns ?? [])].sort((a, b) => a.order - b.order);
        setColumns(sorted);
        if (sorted[0]) setColumnId(sorted[0].id);
      })
      .catch(() => {
        toast({ title: "Erro", description: "Não foi possível carregar colunas do kanban.", variant: "destructive" });
      });
  }, [open]);

  // Reset form quando o modal fecha
  useEffect(() => {
    if (!open) {
      setTitle("");
      setDueDate("");
      setPriority("medium");
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !columnId) {
      toast({ title: "Campos obrigatórios", description: "Preencha o título e selecione uma coluna.", variant: "destructive" });
      return;
    }
    if (Date.now() - savedAt < 1500) return; // anti-double-click
    setSavedAt(Date.now());
    setLoading(true);

    try {
      const res = await fetch("/api/kanban/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          columnId,
          assignedTo: currentUserId,
          leadId,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
          priority,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Falha ao criar tarefa");
      }

      toast({ title: "Tarefa criada", description: `${title} ${dueDate ? "(" + new Date(dueDate).toLocaleString("pt-BR") + ")" : ""}` });
      onCreated?.();
      onClose();
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro inesperado",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl border border-border w-full max-w-md mx-4 p-6 animate-card-entrance"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-h3 text-foreground">Nova tarefa</h2>
            <p className="text-small text-muted mt-0.5">
              Vinculada a <span className="text-primary font-medium">{leadName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-label block mb-1.5">Título</label>
            <input
              type="text"
              required
              autoFocus
              maxLength={255}
              placeholder="Ex.: Ligar pra confirmar reunião"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition-colors duration-200 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-label block mb-1.5">Data e hora</label>
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => setDueDate(dueIn(1))} className="text-xs px-2 py-1 rounded bg-surface-2 hover:bg-surface-2/80 text-muted hover:text-foreground transition-colors cursor-pointer">+1h</button>
              <button type="button" onClick={() => setDueDate(dueIn(3))} className="text-xs px-2 py-1 rounded bg-surface-2 hover:bg-surface-2/80 text-muted hover:text-foreground transition-colors cursor-pointer">+3h</button>
              <button type="button" onClick={() => setDueDate(dueIn(24))} className="text-xs px-2 py-1 rounded bg-surface-2 hover:bg-surface-2/80 text-muted hover:text-foreground transition-colors cursor-pointer">Amanhã</button>
              <button type="button" onClick={() => setDueDate(dueIn(72))} className="text-xs px-2 py-1 rounded bg-surface-2 hover:bg-surface-2/80 text-muted hover:text-foreground transition-colors cursor-pointer">3 dias</button>
            </div>
            <div className="relative">
              <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={loading}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition-colors duration-200 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="text-label block mb-1.5">Prioridade</label>
            <div className="grid grid-cols-4 gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  disabled={loading}
                  className={`px-2 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200 cursor-pointer ${
                    priority === p.value
                      ? `${p.color} bg-surface-2 text-foreground`
                      : "border-border bg-background text-muted hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {columns.length > 1 && (
            <div>
              <label className="text-label block mb-1.5">Coluna</label>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition-colors duration-200 disabled:opacity-50 cursor-pointer"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg border border-border text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim() || !columnId}
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar tarefa"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
