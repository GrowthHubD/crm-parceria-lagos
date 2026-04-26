"use client";

import { useState, useEffect } from "react";
import { User, Phone, Calendar, CheckCircle2, XCircle, Loader2, Pencil, Unlink, ExternalLink, MessageSquare, RotateCcw, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { WhatsAppConnect } from "@/components/crm/whatsapp-connect";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
}

interface GoogleCalendar {
  googleEmail: string | null;
  googleCalendarId: string;
}

interface MessageTemplate {
  id: string;
  label: string;
  body: string;
  variables: string[];
  updatedAt: string | null;
}

const JOB_TITLE_LABELS: Record<string, string> = {
  gestor_trafego: "Gestor de Tráfego",
  gestor_automacao: "Gestor de Automação",
  social_media: "Social Media",
  designer: "Designer",
  copywriter: "Copywriter",
  analista: "Analista",
  diretor: "Diretor",
};

export default function ConfiguracoesPage() {
  const { data: session } = useSession();
  const isPartner = (session?.user as { role?: string })?.role === "partner";

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [googleCalendar, setGoogleCalendar] = useState<GoogleCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formJobTitle, setFormJobTitle] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  // Message templates (partner only)
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>({});
  const [savingTemplate, setSavingTemplate] = useState<string | null>(null);

  // Read URL params for Calendar connection result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cal = params.get("calendar");
    if (cal === "connected") {
      toast.success("Google Calendar conectado com sucesso!");
      window.history.replaceState({}, "", "/configuracoes");
    } else if (cal === "error") {
      toast.error("Erro ao conectar Google Calendar. Tente novamente.");
      window.history.replaceState({}, "", "/configuracoes");
    } else if (cal === "no_refresh_token") {
      toast.error("Token de atualização não recebido. Revogue o acesso no Google e tente novamente.");
      window.history.replaceState({}, "", "/configuracoes");
    }
  }, []);

  useEffect(() => {
    fetch("/api/configuracoes")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setProfile(d.profile ?? null);
        setGoogleCalendar(d.googleCalendar ?? null);
        setFormName(d.profile?.name ?? "");
        setFormPhone(d.profile?.phone ?? "");
        setFormJobTitle(d.profile?.jobTitle ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load message templates (partner only)
  useEffect(() => {
    if (!isPartner) return;
    setTemplatesLoading(true);
    fetch("/api/admin/message-templates")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => {
        setTemplates(d.templates ?? []);
        const drafts: Record<string, string> = {};
        (d.templates ?? []).forEach((t: MessageTemplate) => { drafts[t.id] = t.body; });
        setTemplateDrafts(drafts);
      })
      .catch(() => {})
      .finally(() => setTemplatesLoading(false));
  }, [isPartner]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/configuracoes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, phone: formPhone, jobTitle: formJobTitle }),
      });
      if (res.ok) {
        setProfile((p) => p ? { ...p, name: formName, phone: formPhone || null, jobTitle: formJobTitle || null } : p);
        toast.success("Perfil atualizado!");
        setEditingProfile(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/configuracoes", { method: "DELETE" });
      if (res.ok) {
        setGoogleCalendar(null);
        toast.success("Google Calendar desconectado.");
      }
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSaveTemplate = async (id: string) => {
    setSavingTemplate(id);
    try {
      const res = await fetch("/api/admin/message-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, templateBody: templateDrafts[id] }),
      });
      if (res.ok) {
        setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, body: templateDrafts[id] } : t));
        toast.success("Template salvo!");
        setEditingTemplate(null);
      } else {
        toast.error("Erro ao salvar template.");
      }
    } finally {
      setSavingTemplate(null);
    }
  };

  const handleResetTemplate = async (id: string) => {
    const res = await fetch(`/api/admin/message-templates?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      // Reload templates
      fetch("/api/admin/message-templates")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((d) => {
          setTemplates(d.templates ?? []);
          const drafts: Record<string, string> = {};
          (d.templates ?? []).forEach((t: MessageTemplate) => { drafts[t.id] = t.body; });
          setTemplateDrafts(drafts);
          setEditingTemplate(null);
        })
        .catch(() => {});
      toast.success("Template restaurado ao padrão.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-h1 text-foreground">Configurações</h1>
        <p className="text-muted mt-1">Gerencie seu perfil e integrações.</p>
      </div>

      {/* ── Profile ── */}
      <section className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Perfil</h2>
          </div>
          {!editingProfile && (
            <button
              onClick={() => setEditingProfile(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted hover:text-foreground border border-border rounded-lg hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" /> Editar
            </button>
          )}
        </div>

        {editingProfile ? (
          <div className="space-y-4">
            <div>
              <label className="text-label text-muted block mb-1">Nome</label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div>
              <label className="text-label text-muted block mb-1 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> WhatsApp
              </label>
              <input
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="+55 11 99999-9999"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              />
              <p className="text-xs text-muted mt-1">Usado para notificações de tarefas. Qualquer formato aceito (+55, com hífen, etc).</p>
            </div>
            <div>
              <label className="text-label text-muted block mb-1">Cargo</label>
              <select
                value={formJobTitle}
                onChange={(e) => setFormJobTitle(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors cursor-pointer"
              >
                <option value="">Sem cargo</option>
                {Object.entries(JOB_TITLE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setEditingProfile(false); setFormName(profile?.name ?? ""); setFormPhone(profile?.phone ?? ""); setFormJobTitle(profile?.jobTitle ?? ""); }}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <ProfileField label="Nome" value={formName || profile?.name} />
            <ProfileField label="E-mail" value={profile?.email} />
            <ProfileField
              label="WhatsApp"
              value={formPhone || profile?.phone}
              icon={<Phone className="w-3.5 h-3.5 text-success" />}
            />
            <ProfileField
              label="Cargo"
              value={
                (formJobTitle || profile?.jobTitle)
                  ? JOB_TITLE_LABELS[formJobTitle || profile?.jobTitle!] ?? (formJobTitle || profile?.jobTitle)
                  : null
              }
            />
          </div>
        )}
      </section>

      {/* ── WhatsApp Connection ── */}
      <WhatsAppConnect />

      {/* ── Google Calendar ── */}
      <section className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-error/10 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-error" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Google Calendar</h2>
            <p className="text-sm text-muted">Sincronize tarefas do Kanban com sua agenda.</p>
          </div>
        </div>

        {googleCalendar ? (
          <div className="flex items-center justify-between gap-4 bg-success/5 border border-success/20 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Conectado</p>
                {googleCalendar.googleEmail && (
                  <p className="text-xs text-muted">{googleCalendar.googleEmail}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="https://calendar.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:bg-surface-2 transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> Abrir
              </a>
              <button
                onClick={handleDisconnectCalendar}
                disabled={disconnecting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-error border border-error/30 rounded-lg hover:bg-error/5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                Desconectar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 bg-surface-2 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <XCircle className="w-5 h-5 text-muted shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Não conectado</p>
                <p className="text-xs text-muted">Tarefas com prazo serão sincronizadas automaticamente.</p>
              </div>
            </div>
            <a
              href="/api/auth/google-calendar"
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                "bg-[#4285F4] hover:bg-[#3367d6] text-white cursor-pointer"
              )}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
              </svg>
              Conectar Google
            </a>
          </div>
        )}

        <div className="mt-4 p-4 bg-surface-2 rounded-lg space-y-1.5">
          <p className="text-xs font-medium text-foreground">Como funciona</p>
          <p className="text-xs text-muted">• Tarefas do Kanban com data de prazo são criadas como eventos na sua agenda.</p>
          <p className="text-xs text-muted">• Ao editar ou excluir uma tarefa, o evento é atualizado/removido automaticamente.</p>
          <p className="text-xs text-muted">• Cada membro conecta sua própria conta Google para visualizar sua própria agenda.</p>
        </div>
      </section>

      {/* ── Message Templates (partner only) ── */}
      {isPartner && (
        <section className="bg-surface rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Mensagens & Alertas</h2>
              <p className="text-sm text-muted">Personalize os textos enviados via WhatsApp.</p>
            </div>
          </div>

          {templatesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((tmpl) => (
                <div key={tmpl.id} className="border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-surface-2">
                    <p className="text-sm font-medium text-foreground">{tmpl.label}</p>
                    <div className="flex items-center gap-2">
                      {editingTemplate !== tmpl.id && (
                        <>
                          <button
                            onClick={() => handleResetTemplate(tmpl.id)}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted border border-border rounded-lg hover:bg-surface hover:text-foreground transition-colors cursor-pointer"
                            title="Restaurar padrão"
                          >
                            <RotateCcw className="w-3 h-3" /> Padrão
                          </button>
                          <button
                            onClick={() => setEditingTemplate(tmpl.id)}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted border border-border rounded-lg hover:bg-surface hover:text-foreground transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" /> Editar
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    {/* Variable hints */}
                    <div className="flex flex-wrap gap-1.5">
                      {tmpl.variables.map((v) => (
                        <span key={v} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-mono">{v}</span>
                      ))}
                    </div>

                    {editingTemplate === tmpl.id ? (
                      <>
                        <textarea
                          value={templateDrafts[tmpl.id] ?? tmpl.body}
                          onChange={(e) => setTemplateDrafts((prev) => ({ ...prev, [tmpl.id]: e.target.value }))}
                          rows={8}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-primary transition-colors resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditingTemplate(null); setTemplateDrafts((prev) => ({ ...prev, [tmpl.id]: tmpl.body })); }}
                            className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleSaveTemplate(tmpl.id)}
                            disabled={savingTemplate === tmpl.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {savingTemplate === tmpl.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Salvar
                          </button>
                        </div>
                      </>
                    ) : (
                      <pre className="text-xs text-muted whitespace-pre-wrap font-mono bg-background rounded-lg p-3 leading-relaxed">
                        {templateDrafts[tmpl.id] ?? tmpl.body}
                      </pre>
                    )}
                  </div>
                </div>
              ))}

              <p className="text-xs text-muted">
                As variáveis entre <span className="font-mono text-primary">{"{{ }}"}</span> são substituídas automaticamente no envio.
                Use <span className="font-mono">*texto*</span> para negrito no WhatsApp.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ProfileField({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-label text-muted mb-1 flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      <p className="text-sm text-foreground font-medium">{value || <span className="text-muted italic text-xs">Não informado</span>}</p>
    </div>
  );
}
