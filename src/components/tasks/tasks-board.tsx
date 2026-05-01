"use client";

import { useState, useCallback } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, RefreshCw, CheckCircle2, Circle, Trash2, GitBranch, CalendarDays, User2, Search, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { format, isToday as isTodayFn, parseISO, startOfWeek, endOfWeek, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Task {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  assignedTo: string;
  assigneeName: string | null;
  leadId: string | null;
  leadName: string | null;
  dueDate: string | null;
  priority: string;
  isCompleted: boolean;
  order: number;
  createdAt: string;
}

interface Column {
  id: string;
  name: string;
  color: string | null;
  order: number;
}

interface TeamUser {
  id: string;
  name: string;
}

interface Lead {
  id: string;
  name: string;
  phone: string | null;
  stageName: string | null;
  stageColor: string | null;
}

interface TasksBoardProps {
  initialColumns: Column[];
  initialTasks: Task[];
  users: TeamUser[];
  leads: Lead[];
  currentUserId: string;
  canEdit: boolean;
  canDelete: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "border-error/60 bg-error/5",
  high: "border-error/30",
  medium: "",
  low: "border-success/30",
};

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-error animate-pulse",
  high: "bg-error",
  medium: "bg-warning",
  low: "bg-success",
};

// ── Task Card ──────────────────────────────────────────────────────────────

function TaskItem({
  task,
  onToggle,
  onDelete,
  canEdit,
  canDelete,
}: {
  task: Task;
  onToggle: (id: string, current: boolean) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isOverdue = task.dueDate && !task.isCompleted && new Date(task.dueDate + "T23:59:59") < new Date();
  const isDueToday = task.dueDate && isTodayFn(new Date(task.dueDate + "T12:00:00"));

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "bg-surface border border-border rounded-lg p-3 group select-none touch-none",
        "hover:border-primary/40 transition-all duration-150 cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40 shadow-lg",
        isOverdue && "border-error/40",
        PRIORITY_COLORS[task.priority]
      )}
    >
      <div className="flex items-start gap-2">
        {canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(task.id, task.isCompleted); }}
            className="mt-0.5 shrink-0 cursor-pointer"
          >
            {task.isCompleted ? (
              <CheckCircle2 className="w-4 h-4 text-success" />
            ) : (
              <Circle className="w-4 h-4 text-muted" />
            )}
          </button>
        )}

        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-medium text-foreground truncate",
            task.isCompleted && "line-through text-muted"
          )}>
            {task.title}
          </p>

          {task.description && (
            <p className="text-xs text-muted mt-0.5 line-clamp-1">{task.description}</p>
          )}

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={cn("w-2 h-2 rounded-full shrink-0", PRIORITY_DOT[task.priority])} />

            {task.dueDate && (
              <span className={cn(
                "text-xs",
                isOverdue ? "text-error" : isDueToday ? "text-warning" : "text-muted"
              )}>
                {format(new Date(task.dueDate + "T12:00:00"), "dd/MM", { locale: ptBR })}
                {isDueToday && " (hoje)"}
              </span>
            )}

            {task.leadName && (
              <Link
                href="/pipeline"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-0.5 text-xs text-primary hover:text-primary-hover transition-colors"
              >
                <User2 className="w-3 h-3" />
                {task.leadName}
              </Link>
            )}

            {task.assigneeName && (
              <span className="text-xs text-muted">{task.assigneeName}</span>
            )}
          </div>
        </div>

        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-error transition-all cursor-pointer shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Column ──────────────────────────────────────────────────────────────

function TaskColumn({
  column,
  tasks,
  onToggle,
  onDelete,
  onAddTask,
  canEdit,
  canDelete,
}: {
  column: Column;
  tasks: Task[];
  onToggle: (id: string, current: boolean) => void;
  onDelete: (id: string) => void;
  onAddTask: (columnId: string) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const incomplete = tasks.filter((t) => !t.isCompleted).length;

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: column.color ?? "#6C5CE7" }} />
          <h3 className="text-xs font-semibold text-foreground truncate">{column.name}</h3>
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
            style={{ backgroundColor: `${column.color ?? "#6C5CE7"}20`, color: column.color ?? "#6C5CE7" }}
          >
            {incomplete}
          </span>
        </div>
        {canEdit && (
          <button
            onClick={() => onAddTask(column.id)}
            className="p-1 rounded text-muted/60 hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 flex flex-col gap-2 min-h-[120px] rounded-xl p-2 transition-colors",
          "bg-surface-2/50 border border-border/60",
          isOver && "border-primary/60 bg-primary/5"
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onToggle={onToggle}
              onDelete={onDelete}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-6">
            <p className="text-xs text-muted/40 text-center">Arraste uma tarefa aqui</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Board ──────────────────────────────────────────────────────────

export function TasksBoard({ initialColumns, initialTasks, users, leads, currentUserId, canEdit, canDelete }: TasksBoardProps) {
  const [columns] = useState(initialColumns);
  const [tasks, setTasks] = useState(initialTasks);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "today" | "week">("all");
  const [filterLeadId, setFilterLeadId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formColumnId, setFormColumnId] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [formPriority, setFormPriority] = useState("medium");
  const [formAssignedTo, setFormAssignedTo] = useState(currentUserId);
  const [formLeadId, setFormLeadId] = useState("");
  const [formLeadSearch, setFormLeadSearch] = useState("");
  const [formSyncCalendar, setFormSyncCalendar] = useState(false);
  const [creating, setCreating] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Filtrar tarefas
  const filteredTasks = tasks.filter((t) => {
    // Filtro por lead
    if (filterLeadId && t.leadId !== filterLeadId) return false;

    if (filter === "all") return true;
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate + "T12:00:00");
    if (filter === "today") return isTodayFn(d);
    if (filter === "week") {
      const now = new Date();
      return isWithinInterval(d, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) });
    }
    return true;
  });

  // Leads que têm tarefas (para o filtro rápido)
  const leadsWithTasks = leads.filter((l) => tasks.some((t) => t.leadId === l.id));

  const getTasksForColumn = (colId: string) => filteredTasks.filter((t) => t.columnId === colId);

  // DnD handlers
  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveTask(tasks.find((t) => t.id === active.id) ?? null);
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const overCol = columns.find((c) => c.id === String(over.id));
    if (overCol) {
      setTasks((prev) => prev.map((t) => t.id === String(active.id) ? { ...t, columnId: overCol.id } : t));
      return;
    }
    const overTask = tasks.find((t) => t.id === String(over.id));
    if (overTask) {
      setTasks((prev) => prev.map((t) => t.id === String(active.id) ? { ...t, columnId: overTask.columnId } : t));
    }
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveTask(null);
    if (!over) return;
    const movedTask = tasks.find((t) => t.id === String(active.id));
    if (!movedTask) return;

    await fetch(`/api/kanban/tasks/${active.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: movedTask.columnId }),
    });
  };

  const handleToggle = async (id: string, current: boolean) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, isCompleted: !current } : t));
    await fetch(`/api/kanban/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCompleted: !current }),
    });
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setTasks((prev) => prev.filter((t) => t.id !== pendingDelete));
    await fetch(`/api/kanban/tasks/${pendingDelete}`, { method: "DELETE" });
    setPendingDelete(null);
  };

  const handleAddTask = (columnId: string) => {
    setFormColumnId(columnId);
    setFormTitle("");
    setFormDueDate("");
    setFormPriority("medium");
    setFormAssignedTo(currentUserId);
    setFormLeadId("");
    setFormLeadSearch("");
    setFormSyncCalendar(false);
    setShowForm(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;
    setCreating(true);

    try {
      const res = await fetch("/api/kanban/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formTitle.trim(),
          columnId: formColumnId,
          assignedTo: formAssignedTo,
          dueDate: formDueDate || null,
          priority: formPriority,
          leadId: formLeadId || null,
          syncCalendar: formSyncCalendar,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const assignee = users.find((u) => u.id === formAssignedTo);
        const selectedLead = formLeadId ? leads.find((l) => l.id === formLeadId) : null;
        setTasks((prev) => [...prev, {
          ...data.task,
          assigneeName: assignee?.name ?? null,
          leadId: formLeadId || null,
          leadName: selectedLead?.name ?? null,
        }]);
        setShowForm(false);
        toast.success("Tarefa criada!");
      }
    } catch {
      toast.error("Erro ao criar tarefa");
    } finally {
      setCreating(false);
    }
  };

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.isCompleted).length;

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tarefas</h1>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted">
            <span><strong className="text-foreground">{totalTasks}</strong> tarefas</span>
            <span><strong className="text-success">{completedTasks}</strong> concluídas</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {/* Botão primário: criar nova tarefa (na 1ª coluna por default) */}
          {canEdit && columns[0] && (
            <button
              onClick={() => handleAddTask(columns[0].id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Nova tarefa
            </button>
          )}

          {/* Filtro por data */}
          {["all", "today", "week"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as typeof filter)}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                filter === f ? "bg-primary text-white" : "text-muted hover:text-foreground border border-border hover:bg-surface-2"
              )}
            >
              {f === "all" ? "Todas" : f === "today" ? "Hoje" : "Semana"}
            </button>
          ))}

          {/* Filtro por lead */}
          {leadsWithTasks.length > 0 && (
            <div className="relative">
              <select
                value={filterLeadId ?? ""}
                onChange={(e) => setFilterLeadId(e.target.value || null)}
                className="appearance-none bg-surface-2 border border-border rounded-lg pl-7 pr-6 py-1 text-xs text-foreground focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="">Todos os leads</option>
                {leadsWithTasks.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <User2 className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
            </div>
          )}

          {filterLeadId && (
            <button
              onClick={() => setFilterLeadId(null)}
              className="p-1 rounded text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
              title="Limpar filtro"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto pb-4 -mx-2 px-2">
          <div className="flex gap-3 min-w-max">
            {columns.map((col) => (
              <TaskColumn
                key={col.id}
                column={col}
                tasks={getTasksForColumn(col.id)}
                onToggle={handleToggle}
                onDelete={(id) => setPendingDelete(id)}
                onAddTask={handleAddTask}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="rotate-1 shadow-xl opacity-95 w-72">
              <TaskItem task={activeTask} onToggle={() => {}} onDelete={() => {}} canEdit={false} canDelete={false} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Quick create form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <form onSubmit={handleCreateTask} className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Nova Tarefa</h3>
            <input
              autoFocus
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Título da tarefa"
              required
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
                className="bg-surface-2 border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              />
              <select
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value)}
                className="bg-surface-2 border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <select
              value={formAssignedTo}
              onChange={(e) => setFormAssignedTo(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:border-primary cursor-pointer"
            >
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>

            {/* Vincular a um lead */}
            <div className="relative">
              <label className="text-xs text-muted mb-1 block">Vincular a lead (opcional)</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
                <input
                  value={formLeadId ? (leads.find((l) => l.id === formLeadId)?.name ?? formLeadSearch) : formLeadSearch}
                  onChange={(e) => {
                    setFormLeadSearch(e.target.value);
                    if (formLeadId) setFormLeadId("");
                  }}
                  placeholder="Buscar lead por nome..."
                  className="w-full bg-surface-2 border border-border rounded-lg pl-8 pr-8 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
                />
                {formLeadId && (
                  <button
                    type="button"
                    onClick={() => { setFormLeadId(""); setFormLeadSearch(""); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {formLeadSearch && !formLeadId && (
                <div className="absolute z-10 mt-1 w-full bg-surface border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {leads
                    .filter((l) => l.name.toLowerCase().includes(formLeadSearch.toLowerCase()))
                    .slice(0, 8)
                    .map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => { setFormLeadId(l.id); setFormLeadSearch(""); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 transition-colors cursor-pointer"
                      >
                        <User2 className="w-3.5 h-3.5 text-muted shrink-0" />
                        <div className="min-w-0">
                          <p className="text-foreground truncate">{l.name}</p>
                          <p className="text-xs text-muted truncate">
                            {l.stageName && (
                              <span className="inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: l.stageColor ?? "#6C5CE7" }} />
                                {l.stageName}
                              </span>
                            )}
                            {l.phone && ` · ${l.phone}`}
                          </p>
                        </div>
                      </button>
                    ))
                  }
                  {leads.filter((l) => l.name.toLowerCase().includes(formLeadSearch.toLowerCase())).length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted">Nenhum lead encontrado</p>
                  )}
                </div>
              )}
            </div>

            {formDueDate && (
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={formSyncCalendar}
                  onChange={(e) => setFormSyncCalendar(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                Adicionar à agenda (Google Calendar)
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-3 py-2 text-sm text-muted border border-border rounded-lg hover:bg-surface-2 cursor-pointer">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating || !formTitle.trim()}
                className="flex-1 px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
              >
                {creating ? "Criando..." : "Criar"}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Excluir tarefa"
        message="Tem certeza que deseja excluir esta tarefa?"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
