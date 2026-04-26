"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, CheckCircle2, XCircle, Phone, QrCode } from "lucide-react";

export interface PartnerClient {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  billingStatus: string;
  billingEmail: string | null;
  createdAt: string;
  whatsappActive: boolean | null;
  whatsappPhone: string | null;
}

interface Props {
  initialClients: PartnerClient[];
}

export function PartnerClientsManager({ initialClients }: Props) {
  const router = useRouter();
  // Lista vem direto da prop (SSR). Depois de criar, chamamos router.refresh() e o Next re-renderiza.
  const clients = initialClients;
  const [showForm, setShowForm] = useState(false);
  const [qrClientId, setQrClientId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  async function handleConnectWhatsapp(clientId: string) {
    setQrClientId(clientId);
    setQrCode(null);
    setQrLoading(true);
    try {
      const res = await fetch("/api/uazapi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": clientId },
        body: JSON.stringify({ tenantId: clientId }),
      });
      const data = await res.json();
      if (data.status === "connected") {
        setQrClientId(null);
        router.refresh();
      } else if (data.qrCode) {
        setQrCode(data.qrCode);
      }
    } catch {
      setQrClientId(null);
    } finally {
      setQrLoading(false);
    }
  }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [plan, setPlan] = useState<"free" | "pro" | "enterprise">("pro");
  const [magicLink, setMagicLink] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/partner/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          billingEmail: billingEmail.trim() || undefined,
          adminEmail: adminEmail.trim() || undefined,
          adminName: adminName.trim() || undefined,
          plan,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Erro ao criar cliente");
        return;
      }

      // Se gerou magic link, mostra pro parceiro compartilhar
      const link = data.client?.magicLink as string | undefined;
      if (link) {
        setMagicLink(link);
      } else {
        setShowForm(false);
        setName("");
        setSlug("");
        setBillingEmail("");
        setAdminEmail("");
        setAdminName("");
        setPlan("pro");
      }
      router.refresh();
    } catch {
      setError("Falha de rede");
    } finally {
      setSubmitting(false);
    }
  }

  // Auto-gera slug a partir do nome (pode ser editado depois)
  function handleNameChange(v: string) {
    setName(v);
    const autoSlug = v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setSlug(autoSlug);
  }

  return (
    <div className="space-y-4">
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition"
        >
          <Plus className="w-4 h-4" />
          Novo cliente
        </button>
      )}

      {magicLink && (
        <div className="bg-success/10 border border-success/30 rounded-xl p-4 space-y-2">
          <p className="font-medium text-success">Cliente criado! Link mágico gerado.</p>
          <p className="text-small text-muted">
            Compartilhe este link com o admin do cliente — ao abrir, ele loga automaticamente e conecta o WhatsApp:
          </p>
          <div className="flex items-center gap-2 bg-surface-2 rounded-lg p-2">
            <input
              type="text"
              readOnly
              value={magicLink}
              className="flex-1 bg-transparent text-xs font-mono outline-none"
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(magicLink);
              }}
              className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-90"
            >
              Copiar
            </button>
          </div>
          <button
            onClick={() => {
              setMagicLink(null);
              setShowForm(false);
              setName("");
              setSlug("");
              setBillingEmail("");
              setAdminEmail("");
              setAdminName("");
              setPlan("pro");
            }}
            className="text-small text-muted hover:text-foreground"
          >
            Fechar
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-xl p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold">Criar novo cliente</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-small text-muted block mb-1">Nome da empresa *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground"
                placeholder="Acme Advogados"
              />
            </div>

            <div>
              <label className="text-small text-muted block mb-1">Slug (identificador único) *</label>
              <input
                type="text"
                required
                pattern="[a-z0-9\-]+"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground font-mono text-sm"
                placeholder="acme-advogados"
              />
              <p className="text-xs text-muted/70 mt-1">Só letras minúsculas, números e hífens</p>
            </div>

            <div>
              <label className="text-small text-muted block mb-1">Email de cobrança</label>
              <input
                type="email"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground"
                placeholder="financeiro@acme.com.br"
              />
            </div>

            <div>
              <label className="text-small text-muted block mb-1">Plano</label>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as typeof plan)}
                className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            <div>
              <label className="text-small text-muted block mb-1">Email do admin do cliente</label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground"
                placeholder="dono@acme.com.br"
              />
              <p className="text-xs text-muted/70 mt-1">
                Receberá link mágico pra conectar o WhatsApp.
              </p>
            </div>

            <div>
              <label className="text-small text-muted block mb-1">Nome do admin</label>
              <input
                type="text"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground"
                placeholder="Nome completo"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {submitting ? "Provisionando..." : "Criar cliente"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
              className="px-4 py-2 text-muted hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {clients.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-12 text-center">
          <p className="text-muted">Nenhum cliente ainda.</p>
          <p className="text-small text-muted/70 mt-1">Clique em &ldquo;Novo cliente&rdquo; pra começar.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {clients.map((c) => (
            <div
              key={c.id}
              className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between hover:border-primary/40 transition"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-foreground truncate">{c.name}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted">
                    {c.plan}
                  </span>
                  {c.status !== "active" && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning">
                      {c.status}
                    </span>
                  )}
                </div>
                <p className="text-small text-muted mt-0.5 font-mono">{c.slug}</p>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  {c.whatsappActive ? (
                    <div className="flex items-center gap-1 text-small text-success">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <Phone className="w-3.5 h-3.5" />
                      <span>{c.whatsappPhone}</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConnectWhatsapp(c.id)}
                      className="flex items-center gap-1.5 text-small text-primary hover:underline"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      Conectar WhatsApp
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal QR code */}
      {qrClientId && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setQrClientId(null)}
        >
          <div
            className="bg-surface border border-border rounded-xl p-6 max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold mb-2">Conectar WhatsApp</h3>
            <p className="text-small text-muted mb-4">
              Escaneie o QR code com o WhatsApp do cliente
            </p>

            <div className="bg-white p-4 rounded-lg mb-4 min-h-[280px] flex items-center justify-center">
              {qrLoading && !qrCode && <Loader2 className="w-8 h-8 animate-spin text-muted" />}
              {qrCode && (
                <img
                  src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                  alt="QR Code"
                  className="max-w-full"
                />
              )}
              {!qrLoading && !qrCode && (
                <p className="text-small text-muted">Falha ao gerar QR</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleConnectWhatsapp(qrClientId)}
                disabled={qrLoading}
                className="flex-1 px-3 py-2 bg-surface-2 rounded-lg text-sm hover:bg-surface-2/70 disabled:opacity-50"
              >
                Atualizar QR
              </button>
              <button
                onClick={() => setQrClientId(null)}
                className="flex-1 px-3 py-2 text-muted hover:text-foreground text-sm"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
