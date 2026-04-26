"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeadCard } from "./lead-card";

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
}

interface Stage {
  id: string;
  name: string;
  color: string | null;
  order: number;
}

interface KanbanColumnProps {
  stage: Stage;
  leads: Lead[];
  onAddLead: (stageId: string) => void;
  onEditLead: (lead: Lead) => void;
  onDeleteLead: (id: string) => void;
  onOpenConversation?: (conversationId: string) => void;
  canEdit: boolean;
  canDelete: boolean;
}

export function KanbanColumn({
  stage,
  leads,
  onAddLead,
  onEditLead,
  onDeleteLead,
  onOpenConversation,
  canEdit,
  canDelete,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [menuOpen, setMenuOpen] = useState(false);
  // Memoiza IDs pra SortableContext não re-registrar o dnd-kit em cada render
  const leadIds = useMemo(() => leads.map((l) => l.id), [leads]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const stageColor = stage.color ?? "#6C5CE7";
  const totalValue = leads.reduce((sum, l) => sum + (Number(l.estimatedValue) || 0), 0);

  return (
    <div className="flex flex-col w-72 shrink-0">
      {/* Column header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: stageColor }}
          />
          <h3 className="text-xs font-semibold text-foreground capitalize truncate">
            {stage.name.replace(/_/g, " ")}
          </h3>
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0 min-w-[20px] text-center"
            style={{ backgroundColor: `${stageColor}20`, color: stageColor }}
          >
            {leads.length}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canEdit && (
            <button
              onClick={() => onAddLead(stage.id)}
              className="p-1 rounded text-muted/60 hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
              title="Adicionar lead"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1 rounded text-muted/60 hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-6 z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                {canEdit && (
                  <button
                    onClick={() => { setMenuOpen(false); onAddLead(stage.id); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Novo lead aqui
                  </button>
                )}
                <div className="px-3 py-1.5 text-xs text-muted/60 border-t border-border mt-1">
                  {totalValue > 0
                    ? `R$ ${totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} est.`
                    : "Sem valor estimado"}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 flex flex-col gap-2 min-h-[120px] rounded-xl p-2 transition-colors",
          "bg-surface-2/50 border border-border/60",
          isOver && "border-primary/60 bg-primary/5"
        )}
      >
        <SortableContext items={leadIds} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onEdit={onEditLead}
              onDelete={onDeleteLead}
              onOpenConversation={onOpenConversation}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-6">
            <p className="text-xs text-muted/40 text-center">Arraste um lead aqui</p>
          </div>
        )}
      </div>
    </div>
  );
}
