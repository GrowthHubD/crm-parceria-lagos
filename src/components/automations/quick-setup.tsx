"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, CheckCircle2, Pause, Play } from "lucide-react";
import { HistoryModal } from "./history-modal";

interface ExistingStep {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface ExistingAutomation {
  id: string;
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
  isActive: boolean;
  steps: ExistingStep[];
}

interface Props {
  existing: ExistingAutomation[];
}

const DEFAULT_WELCOME = "Olá {{nome}}! 👋\n\nRecebemos sua mensagem e em breve um de nossos atendentes vai te responder. Enquanto isso, fica à vontade pra nos contar mais.";

/**
 * Quick Setup pras 2 automações MVP: welcome + follow-up.
 * - Se já existe: mostra "Salvar alterações" + toggle ativar/desativar
 * - Se não existe: mostra "Ativar boas-vindas"
 */
export function QuickAutomationSetup({ existing }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const welcomeAuto = existing.find((a) => a.triggerType === "first_message");

  const welcomeInitialMsg =
    (welcomeAuto?.steps?.[0]?.config?.message as string | undefined) ?? DEFAULT_WELCOME;

  const [welcomeMsg, setWelcomeMsg] = useState(welcomeInitialMsg);

  async function saveWelcome() {
    setLoading("welcome");
    try {
      if (welcomeAuto) {
        await fetch(`/api/automations/${welcomeAuto.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            steps: [
              { type: "send_whatsapp", config: { message: welcomeMsg, delayMinutes: 0 } },
            ],
          }),
        });
      } else {
        await fetch("/api/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Boas-vindas automática",
            description: "Envia mensagem de boas-vindas quando contato inicia conversa",
            triggerType: "first_message",
            steps: [
              { type: "send_whatsapp", config: { message: welcomeMsg, delayMinutes: 0 } },
            ],
          }),
        });
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function toggleWelcome() {
    if (!welcomeAuto) return;
    setLoading("welcome-toggle");
    try {
      await fetch(`/api/automations/${welcomeAuto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !welcomeAuto.isActive }),
      });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Boas-vindas */}
      <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Boas-vindas</h3>
          </div>
          {welcomeAuto && (
            welcomeAuto.isActive ? (
              <span className="flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="w-3.5 h-3.5" /> Ativa
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Pause className="w-3.5 h-3.5" /> Pausada
              </span>
            )
          )}
        </div>
        <p className="text-small text-muted">
          Envia mensagem automática quando um contato inicia conversa pela primeira vez.
        </p>
        <p className="text-xs text-muted/70">⚠ Não dispara em grupos.</p>

        <div>
          <label className="text-small text-muted block mb-1">Mensagem</label>
          <textarea
            value={welcomeMsg}
            onChange={(e) => setWelcomeMsg(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-foreground"
          />
          <p className="text-xs text-muted/70 mt-1">
            Use <code className="font-mono">{"{{nome}}"}</code> pra inserir o nome do contato.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={saveWelcome}
            disabled={loading === "welcome"}
            className="flex-1 min-w-[140px] flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 text-sm"
          >
            {loading === "welcome" && <Loader2 className="w-4 h-4 animate-spin" />}
            {welcomeAuto ? "Salvar alterações" : "Ativar boas-vindas"}
          </button>
          {welcomeAuto && (
            <>
              <HistoryModal automationId={welcomeAuto.id} label="Boas-vindas" />
              <button
                onClick={toggleWelcome}
                disabled={loading === "welcome-toggle"}
                className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm text-muted hover:text-foreground disabled:opacity-50"
              >
                {loading === "welcome-toggle" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : welcomeAuto.isActive ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {welcomeAuto.isActive ? "Desativar" : "Reativar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
