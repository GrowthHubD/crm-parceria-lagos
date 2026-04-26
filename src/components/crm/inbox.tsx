"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Circle, RefreshCw, Wifi, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationView } from "./conversation-view";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Select } from "@/components/ui/select";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  LeadFilters,
  useLeadFiltersFromUrl,
  buildLeadFiltersQuery,
  type FilterTag,
  type FilterStage,
  type FilterFunnel,
} from "@/components/shared/lead-filters";

interface Conversation {
  id: string;
  whatsappNumberId: string;
  contactPhone: string;
  contactJid: string | null;
  contactName: string | null;
  contactPushName: string | null;
  classification: string;
  lastMessageAt: string | null;
  unreadCount: number;
  contactProfilePicUrl: string | null;
  contactAlias: string | null;
  numberLabel: string | null;
  numberPhone: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: string | null;
  lastMessageMediaType: string | null;
}

interface WhatsappNumber {
  id: string;
  label: string;
  phoneNumber: string;
  isActive: boolean;
}

interface InboxProps {
  initialConversations: Conversation[];
  numbers: WhatsappNumber[];
  canEdit: boolean;
  currentUserId: string;
  tags?: FilterTag[];
  stages?: FilterStage[];
  funnels?: FilterFunnel[];
}

const CLASSIFICATION_CONFIG: Record<string, { label: string; color: string }> = {
  hot: { label: "Quente", color: "text-error" },
  warm: { label: "Morno", color: "text-warning" },
  cold: { label: "Frio", color: "text-info" },
  active_client: { label: "Cliente Ativo", color: "text-success" },
  new: { label: "Novo", color: "text-muted" },
};

export function Inbox({
  initialConversations,
  numbers,
  canEdit,
  tags = [],
  stages = [],
  funnels = [],
}: InboxProps) {
  const [conversations, setConversations] = useState(initialConversations);
  const [search, setSearch] = useState("");
  const [numberFilter, setNumberFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, setLastUpdate] = useState(Date.now());
  const prevCount = useRef(initialConversations.length);

  // Filtros compartilhados (URL-driven)
  const sharedFilters = useLeadFiltersFromUrl();

  const refresh = useCallback(async (silent = true) => {
    try {
      // Combina filtros compartilhados (URL) + filtros locais (number)
      const sharedQs = buildLeadFiltersQuery(sharedFilters);
      const params = new URLSearchParams(sharedQs);
      if (numberFilter !== "all") params.set("numberId", numberFilter);
      // classification do shared já vai como `classification`; mas o legado usava
      // estado local. Agora vem 100% do URL → buildLeadFiltersQuery setou.
      const qs = params.toString();
      const res = await fetch(`/api/crm${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations);
        if (data.conversations.length !== prevCount.current) {
          prevCount.current = data.conversations.length;
          setLastUpdate(Date.now());
        }
      }
    } catch { /* silent */ }
  }, [numberFilter, sharedFilters]);

  // Refetch quando filtros compartilhados mudam (URL params)
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll como fallback — 10s quando visível, 30s background (Realtime cobre o resto)
  useEffect(() => {
    const getInterval = () => document.visibilityState === "visible" ? 10000 : 30000;
    let interval = setInterval(() => refresh(), getInterval());

    const onVisibility = () => {
      clearInterval(interval);
      if (document.visibilityState === "visible") refresh();
      interval = setInterval(() => refresh(), getInterval());
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // Realtime: dispara refresh imediato quando chega mensagem nova ou conversa atualiza
  useEffect(() => {
    const supa = getSupabaseBrowser();
    const channel = supa
      .channel("crm-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "crm_message" },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "crm_conversation" },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "crm_conversation" },
        () => refresh()
      )
      .subscribe();

    return () => {
      supa.removeChannel(channel);
    };
  }, [refresh]);

  // Search e number filter aplicados client-side sobre a lista já filtrada pelo server.
  const filtered = conversations.filter((c) => {
    const name = c.contactName ?? c.contactPushName ?? c.contactPhone;
    const matchSearch = !search || name.toLowerCase().includes(search.toLowerCase()) || c.contactPhone.includes(search);
    const matchNumber = numberFilter === "all" || c.whatsappNumberId === numberFilter;
    return matchSearch && matchNumber;
  });

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    // Zero out unread count locally
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    );
  };

  if (selectedId) {
    return (
      <ConversationView
        conversationId={selectedId}
        canEdit={canEdit}
        onBack={() => setSelectedId(null)}
        onClassificationChange={(id, classification) => {
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, classification } : c))
          );
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros compartilhados (tag, stage, classificação, funil) */}
      <LeadFilters
        tags={tags}
        stages={stages}
        funnels={funnels}
        show={{ tags: true, stages: true, classification: true, funnel: funnels.length > 1 }}
      />

      {/* Filtros específicos do CRM (busca + número) */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar contato..."
            className="bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary w-52 transition-colors"
          />
        </div>
        {numbers.length > 1 && (
          <Select
            value={numberFilter}
            onChange={setNumberFilter}
            options={[
              { value: "all", label: "Todos os números" },
              ...numbers.map((n) => ({ value: n.id, label: n.label })),
            ]}
          />
        )}
        {totalUnread > 0 && (
          <span className="ml-auto bg-primary text-white text-xs px-2 py-1 rounded-full font-medium">
            {totalUnread} não lida{totalUnread > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Conversation list */}
      {filtered.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-12 text-center">
          <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
            <Wifi className="w-7 h-7 text-success" />
          </div>
          <p className="text-foreground font-medium text-sm mb-1">WhatsApp conectado</p>
          <p className="text-muted text-xs max-w-xs mx-auto">
            {numbers.length > 0
              ? `Aguardando mensagens em ${numbers[0]?.phoneNumber ?? "—"}. Envie uma mensagem para esse número e ela aparecerá aqui.`
              : "Configure o WhatsApp nas Configurações para começar a receber mensagens."}
          </p>
          <button
            onClick={() => refresh(false)}
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar agora
          </button>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden divide-y divide-border">
          {filtered.map((c) => {
            const name = c.contactAlias ?? c.contactName ?? c.contactPushName ?? c.contactPhone;
            const config = CLASSIFICATION_CONFIG[c.classification] ?? CLASSIFICATION_CONFIG.new;
            const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

            return (
              <button
                key={c.id}
                onClick={() => handleSelectConversation(c.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left cursor-pointer"
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  {c.contactJid?.endsWith("@g.us") ? (
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                  ) : c.contactProfilePicUrl?.startsWith("http") ? (
                    <img
                      src={c.contactProfilePicUrl}
                      alt={name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-sm font-bold text-primary">{initials || "?"}</span>
                    </div>
                  )}
                  {c.unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                      {c.unreadCount > 9 ? "9+" : c.unreadCount}
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-sm font-medium truncate", c.unreadCount > 0 ? "text-foreground" : "text-foreground/80")}>
                      {name}
                    </p>
                    {c.lastMessageAt && (
                      <span className="text-small text-muted shrink-0">
                        {formatDistanceToNow(new Date(c.lastMessageAt), { locale: ptBR, addSuffix: false })}
                      </span>
                    )}
                  </div>
                  {c.lastMessagePreview && (
                    <p
                      className={cn(
                        "text-xs truncate mt-0.5",
                        c.unreadCount > 0 ? "text-foreground/80 font-medium" : "text-muted"
                      )}
                    >
                      {c.lastMessageDirection === "outgoing" && (
                        <span className="opacity-60">Você: </span>
                      )}
                      {c.lastMessagePreview}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <Circle className={cn("w-2 h-2 fill-current shrink-0", config.color)} />
                    <span className={cn("text-small", config.color)}>{config.label}</span>
                    {c.numberLabel && (
                      <span className="text-small text-muted/60 ml-auto truncate">{c.numberLabel}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
