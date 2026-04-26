"use client";

import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreVertical, Pencil, Trash2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { NextFollowUpBadge, type NextFollowUpData } from "@/components/automations/next-followup-badge";

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
  nextFollowUp?: NextFollowUpData | null;
  crmConversationId?: string | null;
  contactProfilePicUrl?: string | null;
  contactPushName?: string | null;
  lastMessage?: {
    preview: string;
    direction: string;
    timestamp: string;
  } | null;
}

interface LeadCardProps {
  lead: Lead;
  onEdit: (lead: Lead) => void;
  onDelete: (id: string) => void;
  onOpenConversation?: (conversationId: string) => void;
  canEdit: boolean;
  canDelete: boolean;
}

export function LeadCard({ lead, onEdit, onDelete, onOpenConversation, canEdit, canDelete }: LeadCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id });

  const [menuOpen, setMenuOpen] = useState(false);
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const firstTag = lead.tags[0] ?? null;
  const hasValue = lead.estimatedValue && Number(lead.estimatedValue) > 0;
  const updatedDate = format(new Date(lead.updatedAt), "dd/MM/yyyy", { locale: ptBR });

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "bg-surface border border-border rounded-lg p-3 group select-none touch-none",
        "hover:border-primary/40 hover:shadow-sm transition-all duration-150",
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40 cursor-grabbing shadow-lg"
      )}
    >
      <div className="flex items-start gap-2">
        {/* Avatar */}
        <Avatar name={lead.name} picUrl={lead.contactProfilePicUrl} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Name + company */}
          <p className="text-sm font-semibold text-foreground leading-tight truncate">{lead.name}</p>
          {lead.companyName && (
            <p className="text-xs text-muted mt-0.5 truncate">{lead.companyName}</p>
          )}

          {/* Preview da última mensagem — clique abre popup. Drag continua
              funcionando porque o activationConstraint do PointerSensor (8px)
              distingue click de drag. */}
          {lead.lastMessage && (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (lead.crmConversationId && onOpenConversation) {
                  onOpenConversation(lead.crmConversationId);
                }
              }}
              className={cn(
                "mt-1 w-full flex items-start gap-1.5 text-xs text-muted hover:text-foreground transition-colors",
                lead.crmConversationId && onOpenConversation ? "cursor-pointer" : "cursor-default"
              )}
              title="Abrir conversa"
            >
              <MessageCircle className="w-3 h-3 shrink-0 mt-0.5 opacity-60" />
              <span className="truncate flex-1">
                {lead.lastMessage.direction === "outgoing" && <span className="opacity-60">Você: </span>}
                {lead.lastMessage.preview}
              </span>
            </div>
          )}

          {/* Tag pill */}
          {firstTag && (
            <div className="mt-2">
              <span
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${firstTag.color}22`, color: firstTag.color }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: firstTag.color }}
                />
                {firstTag.name}
              </span>
            </div>
          )}

          {/* Value */}
          {hasValue && (
            <p className="text-sm font-bold text-primary mt-2">
              R$ {Number(lead.estimatedValue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          )}

          {/* Próximo follow-up */}
          {lead.nextFollowUp && (
            <div className="mt-2">
              <NextFollowUpBadge data={lead.nextFollowUp} variant="compact" />
            </div>
          )}

          {/* Divider + meta */}
          <div className="border-t border-border mt-2 pt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              Atualizado: {updatedDate}
            </span>
            {lead.tags.length > 1 && (
              <span className="text-xs text-muted">+{lead.tags.length - 1}</span>
            )}
          </div>
        </div>

        {/* ⋮ menu */}
        {(canEdit || canDelete) && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1 rounded text-muted/40 hover:text-muted hover:bg-surface-2 transition-colors cursor-pointer"
              aria-label="Ações"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-6 z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[120px]">
                {canEdit && (
                  <button
                    onClick={() => { setMenuOpen(false); onEdit(lead); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" /> Editar
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => { setMenuOpen(false); onDelete(lead.id); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-error hover:bg-error/10 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> Excluir
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ name, picUrl }: { name: string; picUrl: string | null | undefined }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";

  // contactProfilePicUrl pode ser: null, "none" (quando webhook não achou foto),
  // ou uma URL http(s). Só renderiza como imagem se começar com http.
  if (picUrl && picUrl.startsWith("http")) {
    return (
      <div
        role="img"
        aria-label={name}
        className="w-9 h-9 rounded-full shrink-0 bg-surface-2 bg-cover bg-center"
        style={{ backgroundImage: `url("${picUrl}")` }}
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
      {initials}
    </div>
  );
}
