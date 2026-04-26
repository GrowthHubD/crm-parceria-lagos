import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "@/lib/auth-server";
import {
  Building2, Mail, Phone, FileText, Users, ChevronRight,
  Calendar, MessageSquare,
} from "lucide-react";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { client, clientFile, clientResponsible } from "@/lib/db/schema/clients";
import { contract } from "@/lib/db/schema/contracts";
import { user } from "@/lib/db/schema/users";
import { eq } from "drizzle-orm";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const metadata: Metadata = { title: "Detalhe do Cliente" };

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: "Ativo", className: "bg-success/10 text-success" },
  inactive: { label: "Inativo", className: "bg-muted/20 text-muted" },
  expiring: { label: "A Vencer", className: "bg-warning/10 text-warning" },
};

export default async function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;
  const canView = await checkPermission(session.user.id, userRole, "clients", "view");
  if (!canView) redirect("/");

  const [clientData] = await db
    .select()
    .from(client)
    .where(eq(client.id, id))
    .limit(1);

  if (!clientData) notFound();

  const [files, responsibles, contracts] = await Promise.all([
    db.select().from(clientFile).where(eq(clientFile.clientId, id)),
    db
      .select({
        id: clientResponsible.id,
        role: clientResponsible.role,
        userName: user.name,
        userEmail: user.email,
      })
      .from(clientResponsible)
      .innerJoin(user, eq(clientResponsible.userId, user.id))
      .where(eq(clientResponsible.clientId, id)),
    db
      .select()
      .from(contract)
      .where(eq(contract.clientId, id)),
  ]);

  const statusInfo = STATUS_LABELS[clientData.status] ?? STATUS_LABELS.inactive;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-small text-muted">
        <Link href="/clientes" className="hover:text-foreground transition-colors">
          Clientes
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground">{clientData.companyName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-h1 text-foreground">{clientData.companyName}</h1>
            <span className={cn("px-2 py-1 rounded-md text-xs font-medium", statusInfo.className)}>
              {statusInfo.label}
            </span>
          </div>
          {clientData.cnpj && (
            <p className="text-muted text-sm mt-1">CNPJ: {clientData.cnpj}</p>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact info */}
          <div className="bg-surface rounded-xl border border-border p-6">
            <h2 className="text-h3 text-foreground mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              Informações de Contato
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-label text-muted">Responsável</p>
                <p className="text-foreground mt-1">{clientData.responsibleName}</p>
              </div>
              {clientData.email && (
                <div>
                  <p className="text-label text-muted">E-mail</p>
                  <a
                    href={`mailto:${clientData.email}`}
                    className="text-primary hover:underline mt-1 flex items-center gap-1 text-sm"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {clientData.email}
                  </a>
                </div>
              )}
              {clientData.phone && (
                <div>
                  <p className="text-label text-muted">Telefone</p>
                  <a
                    href={`tel:${clientData.phone}`}
                    className="text-primary hover:underline mt-1 flex items-center gap-1 text-sm"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    {clientData.phone}
                  </a>
                </div>
              )}
              {clientData.groupId && (
                <div>
                  <p className="text-label text-muted">Grupo WhatsApp</p>
                  <p className="text-foreground mt-1 text-sm flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-success" />
                    {clientData.groupId}
                  </p>
                </div>
              )}
              <div>
                <p className="text-label text-muted">Cadastrado em</p>
                <p className="text-foreground mt-1 text-sm flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {format(new Date(clientData.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </p>
              </div>
            </div>
            {clientData.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-label text-muted mb-2">Observações</p>
                <p className="text-foreground text-sm whitespace-pre-wrap">{clientData.notes}</p>
              </div>
            )}
          </div>

          {/* Contracts */}
          <div className="bg-surface rounded-xl border border-border p-6">
            <h2 className="text-h3 text-foreground mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Contratos ({contracts.length})
            </h2>
            {contracts.length === 0 ? (
              <p className="text-muted text-sm py-4 text-center">Nenhum contrato vinculado</p>
            ) : (
              <div className="space-y-3">
                {contracts.map((c) => {
                  const cStatus = STATUS_LABELS[c.status] ?? STATUS_LABELS.inactive;
                  return (
                    <Link
                      key={c.id}
                      href={`/contratos/${c.id}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-surface-2 hover:bg-surface-2/80 transition-colors group"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{c.companyName}</p>
                        <p className="text-small text-muted mt-0.5">
                          R$ {Number(c.monthlyValue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/mês
                          {c.endDate && ` · Vence em ${format(new Date(c.endDate), "dd/MM/yyyy")}`}
                        </p>
                      </div>
                      <span className={cn("px-2 py-1 rounded text-xs font-medium ml-3", cStatus.className)}>
                        {cStatus.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Responsibles */}
          <div className="bg-surface rounded-xl border border-border p-6">
            <h2 className="text-h3 text-foreground mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Equipe ({responsibles.length})
            </h2>
            {responsibles.length === 0 ? (
              <p className="text-muted text-sm">Nenhum responsável</p>
            ) : (
              <div className="space-y-3">
                {responsibles.map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <span className="text-xs font-medium text-primary">
                        {r.userName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{r.userName}</p>
                      <p className="text-small text-muted capitalize">{r.role === "responsible" ? "Responsável" : "Colaborador"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Files */}
          {files.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-6">
              <h2 className="text-h3 text-foreground mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Arquivos ({files.length})
              </h2>
              <div className="space-y-2">
                {files.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-sm">
                    <FileText className="w-4 h-4 text-muted shrink-0" />
                    <span className="text-foreground truncate">{f.fileName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
