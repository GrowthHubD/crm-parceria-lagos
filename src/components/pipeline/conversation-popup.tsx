"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { ConversationView } from "@/components/crm/conversation-view";

interface Props {
  conversationId: string;
  canEdit: boolean;
  onClose: () => void;
}

/**
 * Modal que embute a ConversationView — acessado via clique no preview da
 * última mensagem no kanban card. Permite ver + responder sem sair do pipeline.
 */
export function ConversationPopup({ conversationId, canEdit, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* close button overlay */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <ConversationView
          conversationId={conversationId}
          canEdit={canEdit}
          onBack={onClose}
          onClassificationChange={() => { /* no-op — pipeline não reconcilia classificação */ }}
        />
      </div>
    </div>
  );
}
