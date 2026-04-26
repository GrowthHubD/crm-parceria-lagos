"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Version {
  id: string;
  stepId: string;
  config: Record<string, unknown>;
  stepType: string;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

interface Props {
  automationId: string;
  label: string; // ex: "Boas-vindas"
}

export function HistoryModal({ automationId, label }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/automations/${automationId}/versions`);
      const data = await res.json();
      if (res.ok) setVersions(data.versions ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function restore(versionId: string) {
    if (!confirm("Restaurar essa versão? A versão atual vai pro histórico também.")) return;
    setRestoringId(versionId);
    try {
      const res = await fetch(
        `/api/automations/${automationId}/versions/${versionId}/restore`,
        { method: "POST" }
      );
      if (res.ok) {
        await load();
        router.refresh();
      }
    } finally {
      setRestoringId(null);
    }
  }

  async function remove(versionId: string) {
    if (!confirm("Excluir permanentemente essa versão do histórico?")) return;
    setDeletingId(versionId);
    try {
      const res = await fetch(
        `/api/automations/${automationId}/versions/${versionId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        // Remove da lista sem refetch
        setVersions((prev) => prev.filter((v) => v.id !== versionId));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm text-muted hover:text-foreground"
        title="Histórico de versões"
      >
        <History className="w-4 h-4" />
        Histórico
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface border border-border rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg">Histórico — {label}</h3>
                <p className="text-small text-muted">
                  Cada edição cria uma versão. Clique em "Restaurar" pra voltar.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted" />
                </div>
              )}

              {!loading && versions.length === 0 && (
                <div className="text-center py-8 text-muted text-small">
                  Nenhuma versão antiga ainda. Toda vez que você salvar uma alteração,
                  a versão anterior fica disponível aqui.
                </div>
              )}

              {!loading &&
                versions.map((v) => {
                  const msg = (v.config?.message as string) ?? "";
                  return (
                    <div
                      key={v.id}
                      className="bg-surface-2 border border-border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted">
                            {format(new Date(v.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                            {" · "}
                            {formatDistanceToNow(new Date(v.createdAt), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                            {v.createdByName && ` · por ${v.createdByName}`}
                          </p>
                          {v.note && (
                            <p className="text-xs text-muted/70 italic mt-0.5">{v.note}</p>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => restore(v.id)}
                            disabled={restoringId === v.id || deletingId === v.id}
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded disabled:opacity-50"
                          >
                            {restoringId === v.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3 h-3" />
                            )}
                            Restaurar
                          </button>
                          <button
                            onClick={() => remove(v.id)}
                            disabled={restoringId === v.id || deletingId === v.id}
                            className="flex items-center gap-1 px-2 py-1 text-xs border border-border text-muted hover:text-destructive hover:border-destructive/50 rounded disabled:opacity-50"
                            title="Excluir versão"
                          >
                            {deletingId === v.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                      <pre className="text-xs text-foreground whitespace-pre-wrap break-words bg-background rounded p-2 border border-border max-h-32 overflow-y-auto">
                        {msg || JSON.stringify(v.config, null, 2)}
                      </pre>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
