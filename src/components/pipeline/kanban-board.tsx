"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Plus, Tags, Columns, X, Trophy } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { KanbanColumn } from "./kanban-column";
import { LeadCard } from "./lead-card";
import { LeadModal } from "./lead-modal";
import { ConversationPopup } from "./conversation-popup";
import {
  LeadFilters,
  useLeadFiltersFromUrl,
} from "@/components/shared/lead-filters";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Lead {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  stageId: string;
  source: string | null;
  estimatedValue: string | null;
  notes: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  updatedAt: string;
  tags: Tag[];
  nextFollowUp?: {
    automationId: string;
    automationName: string;
    scheduledAt: string;
    status: "pending" | "upcoming";
  } | null;
  crmConversationId?: string | null;
  classification?: string | null;
  contactProfilePicUrl?: string | null;
  contactPushName?: string | null;
  lastMessage?: {
    preview: string;
    direction: string;
    timestamp: string;
  } | null;
}

interface Stage {
  id: string;
  name: string;
  color: string | null;
  order: number;
  isWon: boolean;
}

interface TeamUser {
  id: string;
  name: string;
}

interface Funnel {
  id: string;
  name: string;
  isDefault: boolean;
}

interface KanbanBoardProps {
  initialStages: Stage[];
  initialLeads: Lead[];
  initialTags: Tag[];
  users: TeamUser[];
  currentUserId: string;
  funnels: Funnel[];
  activePipelineId: string;
  canEdit: boolean;
  canDelete: boolean;
}

// ── Tag Manager Modal ────────────────────────────────────────────────────────

function TagManagerModal({ tags, onClose, onTagsChange }: {
  tags: Tag[];
  onClose: () => void;
  onTagsChange: (tags: Tag[]) => void;
}) {
  const [localTags, setLocalTags] = useState(tags);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (res.ok) {
        const tag = await res.json();
        const updated = [...localTags, tag];
        setLocalTags(updated);
        onTagsChange(updated);
        setNewName("");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch("/api/pipeline/tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      const updated = localTags.filter((t) => t.id !== id);
      setLocalTags(updated);
      onTagsChange(updated);
    }
  };

  const [pendingTagDelete, setPendingTagDelete] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">Gerenciar Tags</h2>
          <button onClick={onClose} className="p-1 rounded text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Existing tags */}
        <div className="space-y-2 mb-4 max-h-56 overflow-y-auto">
          {localTags.length === 0 && (
            <p className="text-sm text-muted text-center py-4">Nenhuma tag criada</p>
          )}
          {localTags.map((tag) => (
            <div key={tag.id} className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="text-sm text-foreground">{tag.name}</span>
              </div>
              <button
                onClick={() => setPendingTagDelete(tag.id)}
                className="text-xs text-muted hover:text-error transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* New tag */}
        <div className="flex gap-2">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-9 h-9 rounded cursor-pointer border border-border bg-transparent shrink-0"
            title="Cor da tag"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="Nome da tag"
            className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
          />
          <button
            onClick={handleAdd}
            disabled={loading || !newName.trim()}
            className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingTagDelete}
        title="Excluir tag"
        message="Tem certeza que deseja excluir esta tag?"
        onConfirm={() => { if (pendingTagDelete) { handleDelete(pendingTagDelete); setPendingTagDelete(null); } }}
        onCancel={() => setPendingTagDelete(null)}
      />
    </div>
  );
}

// ── New Stage Modal ──────────────────────────────────────────────────────────

function NewStageModal({ onClose, onCreated, pipelineId }: {
  onClose: () => void;
  onCreated: (stage: Stage) => void;
  pipelineId: string;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6C5CE7");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color, pipelineId }),
      });
      if (res.ok) {
        const stage = await res.json();
        onCreated(stage);
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">Nova Etapa</h2>
          <button onClick={onClose} className="p-1 rounded text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted mb-1 block">Nome da etapa</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Ex: Qualificação"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Cor</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-9 h-9 rounded cursor-pointer border border-border bg-transparent"
              />
              <span className="text-xs text-muted">{color}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-muted border border-border rounded-lg hover:bg-surface-2 transition-colors cursor-pointer">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
            className="flex-1 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Criando..." : "Criar Etapa"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Board ───────────────────────────────────────────────────────────────

export function KanbanBoard({
  initialStages,
  initialLeads,
  initialTags,
  users,
  currentUserId,
  funnels: initialFunnels,
  activePipelineId: initialPipelineId,
  canEdit,
  canDelete,
}: KanbanBoardProps) {
  const [stages, setStages] = useState(initialStages);
  const [leads, setLeads] = useState(initialLeads);
  const [allTags, setAllTags] = useState(initialTags);
  const [funnels, setFunnels] = useState(initialFunnels);
  const [activePipelineId, setActivePipelineId] = useState(initialPipelineId);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [openedConvId, setOpenedConvId] = useState<string | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");
  // Filtros compartilhados (URL): tag, stage, classification, pipeline.
  // O picker de funil dedicado fica no header (mantém UX existente);
  // o LeadFilters mostra tag + stage + classification.
  const filters = useLeadFiltersFromUrl();
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [newStageOpen, setNewStageOpen] = useState(false);
  const wonStageId = stages.find((s) => s.isWon)?.id ?? "";
  const isDragging = useRef(false);

  // Polling DESATIVADO enquanto estabilizamos o drag. Race entre polling e
  // PATCH causava snap-back. Pra reativar no futuro: adicionar cache:no-store
  // + janela de graça de 10s+ após PATCH antes de aceitar setLeads do polling.

  // Trocar de funil — refetch dados
  const handleSwitchFunnel = useCallback(async (pipelineId: string) => {
    setActivePipelineId(pipelineId);
    try {
      const res = await fetch(`/api/pipeline?pipelineId=${pipelineId}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStages(data.stages);
        setLeads(data.leads);
      }
    } catch { /* keep current data */ }
  }, []);

  const handleSetWonStage = async (stageId: string) => {
    // Optimistic update
    setStages((prev) => prev.map((s) => ({ ...s, isWon: s.id === stageId })));
    await fetch("/api/pipeline/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: stageId, isWon: true }),
    });
  };
  const [pendingLeadDelete, setPendingLeadDelete] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ─── Filtering ─────────────────────────────────────────────────────────────

  // Memoiza arrays filtrados pra dnd-kit não re-registrar SortableContext em
  // cada render (polling de 5s dispararia re-registro constante → drag quebra).
  const filteredLeads = useMemo(() => {
    let out = leads;
    if (filters.tagId) {
      out = out.filter((l) => l.tags.some((t) => t.id === filters.tagId));
    }
    if (filters.stageId) {
      out = out.filter((l) => l.stageId === filters.stageId);
    }
    if (filters.classification) {
      out = out.filter((l) => l.classification === filters.classification);
    }
    return out;
  }, [leads, filters.tagId, filters.stageId, filters.classification]);

  const leadsByStage = useMemo(() => {
    const m = new Map<string, Lead[]>();
    for (const l of filteredLeads) {
      const arr = m.get(l.stageId) ?? [];
      arr.push(l);
      m.set(l.stageId, arr);
    }
    return m;
  }, [filteredLeads]);

  const getLeadsForStage = useCallback(
    (stageId: string) => leadsByStage.get(stageId) ?? [],
    [leadsByStage]
  );

  // ─── Drag handlers (simplificado) ──────────────────────────────────────────
  //
  // Uma única fonte de mutação: handleDragEnd. Não mexemos em `leads` durante
  // o drag (handleDragOver removido); o feedback visual é o DragOverlay
  // (ghost card flutuando). Isso elimina toda a classe de bugs de estado
  // inconsistente meio-drag.

  const handleDragStart = ({ active }: DragStartEvent) => {
    isDragging.current = true;
    const lead = leads.find((l) => l.id === active.id);
    if (lead) setActiveLead(lead);
  };

  const handleDragCancel = () => {
    isDragging.current = false;
    setActiveLead(null);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    isDragging.current = false;
    setActiveLead(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const movedLead = leads.find((l) => l.id === activeId);
    if (!movedLead) return;
    const startStage = movedLead.stageId;

    // Determina stage de destino: droppable pode ser uma coluna (stage) ou
    // outro lead (pega o stage dele).
    const overStage = stages.find((s) => s.id === overId);
    const overLead = leads.find((l) => l.id === overId);
    const targetStageId = overStage?.id ?? overLead?.stageId ?? startStage;

    // Mesma coluna → reorder ou no-op
    if (targetStageId === startStage) {
      if (overLead && overLead.id !== activeId) {
        const stageLeads = getLeadsForStage(startStage);
        const oldIndex = stageLeads.findIndex((l) => l.id === activeId);
        const newIndex = stageLeads.findIndex((l) => l.id === overId);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const reordered = arrayMove(stageLeads, oldIndex, newIndex);
          setLeads((prev) => {
            const others = prev.filter((l) => l.stageId !== startStage);
            return [...others, ...reordered];
          });
        }
      }
      return;
    }

    // Mudou de coluna → otimista local + PATCH. Se falhar, reverte.
    setLeads((prev) =>
      prev.map((l) => (l.id === activeId ? { ...l, stageId: targetStageId } : l))
    );
    try {
      const res = await fetch(`/api/pipeline/leads/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: targetStageId }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`PATCH failed ${res.status}`);
    } catch {
      // Reverte optimistic update
      setLeads((prev) =>
        prev.map((l) => (l.id === activeId ? { ...l, stageId: startStage } : l))
      );
    }
  };

  // ─── Lead CRUD ─────────────────────────────────────────────────────────────

  const handleAddLead = (stageId: string) => {
    setEditingLead(null);
    setDefaultStageId(stageId);
    setModalOpen(true);
  };

  const handleEditLead = (lead: Lead) => {
    setEditingLead(lead);
    setDefaultStageId(lead.stageId);
    setModalOpen(true);
  };

  const handleDeleteLead = (id: string) => setPendingLeadDelete(id);

  const confirmLeadDelete = async () => {
    if (!pendingLeadDelete) return;
    setPendingLeadDelete(null);
    const res = await fetch(`/api/pipeline/leads/${pendingLeadDelete}`, { method: "DELETE" });
    if (res.ok) setLeads((prev) => prev.filter((l) => l.id !== pendingLeadDelete));
  };

  const handleLeadSaved = useCallback((savedLead: Record<string, unknown>) => {
    const lead = savedLead as unknown as Lead;
    setLeads((prev) => {
      const exists = prev.find((l) => l.id === lead.id);
      if (exists) {
        return prev.map((l) => l.id === lead.id ? { ...l, ...lead, tags: l.tags } : l);
      }
      return [...prev, { ...lead, tags: [], assigneeName: null, updatedAt: new Date().toISOString() }];
    });
  }, []);

  const totalLeads = leads.length;
  const totalValue = leads.reduce((sum, l) => sum + (Number(l.estimatedValue) || 0), 0);

  return (
    <>
      {/* ── Page header row: title + actions ── */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-h1 text-foreground">Pipeline</h1>
            {funnels.length > 1 && (
              <div className="w-48">
                <Select
                  value={activePipelineId}
                  onChange={handleSwitchFunnel}
                  options={funnels.map((f) => ({ value: f.id, label: f.name }))}
                  placeholder="Selecionar funil..."
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted">
            <span><strong className="text-foreground">{totalLeads}</strong> leads</span>
            {totalValue > 0 && (
              <span>
                <strong className="text-success">
                  R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </strong> estimado
              </span>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setTagManagerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <Tags className="w-3.5 h-3.5" />
              Gerenciar Tags
            </button>
            <div className="flex items-center gap-1.5 min-w-[180px]">
              <Trophy className="w-3.5 h-3.5 text-warning shrink-0" />
              <Select
                value={wonStageId}
                onChange={handleSetWonStage}
                placeholder="Etapa de ganho…"
                options={[
                  { value: "", label: "Nenhuma" },
                  ...stages.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
            <button
              onClick={() => setNewStageOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <Columns className="w-3.5 h-3.5" />
              Nova Etapa
            </button>
            <button
              onClick={() => handleAddLead(stages[0]?.id ?? "")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Lead
            </button>
          </div>
        )}
      </div>

      {/* ── Filter bar (compartilhado com /crm) ── */}
      <div className="mb-5">
        <LeadFilters
          tags={allTags}
          stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
          // Funil é selecionado no header dedicado; aqui escondemos pra evitar duplicação.
          show={{ tags: true, stages: true, classification: true, funnel: false }}
        />
      </div>

      {/* ── Board — horizontal scroll ── */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="overflow-x-auto pb-4 -mx-2 px-2">
          <div className="flex gap-3 min-w-max">
            {stages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                leads={getLeadsForStage(stage.id)}
                onAddLead={handleAddLead}
                onEditLead={handleEditLead}
                onDeleteLead={handleDeleteLead}
                onOpenConversation={(id) => setOpenedConvId(id)}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeLead && (
            <div className="rotate-1 shadow-xl opacity-95">
              <LeadCard
                lead={activeLead}
                onEdit={() => {}}
                onDelete={() => {}}
                canEdit={false}
                canDelete={false}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* ── Modals ── */}
      <LeadModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingLead(null); }}
        onSuccess={handleLeadSaved}
        stages={stages}
        users={users}
        currentUserId={currentUserId}
        initialData={
          editingLead
            ? {
                id: editingLead.id,
                name: editingLead.name,
                companyName: editingLead.companyName ?? "",
                email: editingLead.email ?? "",
                phone: editingLead.phone ?? "",
                stageId: editingLead.stageId,
                source: editingLead.source ?? "",
                estimatedValue: editingLead.estimatedValue ?? "",
                notes: editingLead.notes ?? "",
                assignedTo: editingLead.assignedTo ?? "",
              }
            : { stageId: defaultStageId }
        }
        mode={editingLead ? "edit" : "create"}
      />

      {tagManagerOpen && (
        <TagManagerModal
          tags={allTags}
          onClose={() => setTagManagerOpen(false)}
          onTagsChange={setAllTags}
        />
      )}

      {newStageOpen && (
        <NewStageModal
          onClose={() => setNewStageOpen(false)}
          onCreated={(stage) => setStages((prev) => [...prev, stage])}
          pipelineId={activePipelineId}
        />
      )}

      <ConfirmDialog
        open={!!pendingLeadDelete}
        title="Excluir lead"
        message="Tem certeza que deseja excluir este lead? Esta ação não pode ser desfeita."
        onConfirm={confirmLeadDelete}
        onCancel={() => setPendingLeadDelete(null)}
      />

      {openedConvId && (
        <ConversationPopup
          conversationId={openedConvId}
          canEdit={canEdit}
          onClose={() => setOpenedConvId(null)}
        />
      )}
    </>
  );
}
