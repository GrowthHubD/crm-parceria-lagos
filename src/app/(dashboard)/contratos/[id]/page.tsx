import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "@/lib/auth-server";
import {
  FileText, ChevronRight, DollarSign, Calendar,
  AlertTriangle, Building2, ExternalLink,
} from "lucide-react";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { contract } from "@/lib/db/schema/contracts";
import { client } from "@/lib/db/schema/clients";
import { eq } from "drizzle-orm";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";
import { format, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";

export const metadata: Metadata = { title: "Detalhe do Contrato" };

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  active: { label: "Ativo", className: "bg-success/10 text-success" },
  expiring: { label: "A Vencer", className: "bg-warning/10 text-warning" },
  inactive: { label: "Inativo", className: "bg-muted/20 text-muted" },
};

export default async function ContratoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;
  const canView = await checkPermission(session.user.id, userRole, "contracts", "view");
  if (!canView) redirect("/");

  const [contractData] = await db
    .select({
      id: contract.id,
      clientId: contract.clientId,
      companyName: contract.companyName,
      monthlyValue: contract.monthlyValue,
      implementationValue: contract.implementationValue,
      type: contract.type,
      startDate: contract.startDate,
      endDate: contract.endDate,
      paymentDay: contract.paymentDay,
      status: contract.status,
      driveFileId: contract.driveFileId,
      notes: contract.notes,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      clientCompanyName: client.companyName,
      clientResponsibleName: client.responsibleName,
      clientEmail: client.email,
      clientPhone: client.phone,
    })
    .from(contract)
    .leftJoin(client, eq(contract.clientId, client.id))
    .where(eq(contract.id, id))
    .limit(1);

  if (!contractData) notFound();

  const statusInfo = STATUS_MAP[contractData.status] ?? STATUS_MAP.inactive;
  const monthlyValue = Number(contractData.monthlyValue);
  const implementationValue = contractData.implementationValue ? Number(contractData.implementationValue) : null;
  const annualValue = monthlyValue * 12;

  const daysUntilExpiry = contractData.endDate
    ? differenceInDays(new Date(contractData.endDate), new Date())
    : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-small text-muted">
        <Link href="/contratos" className="hover:text-foreground transition-colors">
          Contratos
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground">{contractData.companyName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-h1 text-foreground">{contractData.companyName}</h1>
            <span className={cn("px-2 py-1 rounded-md text-xs font-medium", statusInfo.className)}>
              {statusInfo.label}
            </span>
          </div>
          <p className="text-muted text-sm mt-1">
            {contractData.type === "monthly" ? "Contrato Mensal" : "Contrato Anual"}
          </p>
        </div>
      </div>

      {/* Expiry warning */}
      {daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry >= 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
          <p className="text-warning text-sm">
            {daysUntilExpiry === 0
              ? "Este contrato vence hoje!"
              : `Este contrato vence em ${daysUntilExpiry} dia${daysUntilExpiry !== 1 ? "s" : ""}.`}
          </p>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Financial summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-surface rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-success" />
                <p className="text-label text-muted">Mensalidade</p>
              </div>
              <p className="text-xl font-bold text-success">
                R$ {monthlyValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-info" />
                <p className="text-label text-muted">ARR</p>
              </div>
              <p className="text-xl font-bold text-foreground">
                R$ {annualValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            {implementationValue !== null && implementationValue > 0 && (
              <div className="bg-surface rounded-xl border border-border p-5">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-secondary" />
                  <p className="text-label text-muted">Implantação</p>
                </div>
                <p className="text-xl font-bold text-foreground">
                  R$ {implementationValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
          </div>

          {/* Contract details */}
          <div className="bg-surface rounded-xl border border-border p-6">
            <h2 className="text-h3 text-foreground mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Detalhes do Contrato
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-label text-muted">Início</p>
                <p className="text-foreground mt-1 text-sm flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {format(new Date(contractData.startDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </p>
              </div>
              <div>
                <p className="text-label text-muted">Término</p>
                <p className="text-foreground mt-1 text-sm flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {contractData.endDate
                    ? format(new Date(contractData.endDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
                    : <span className="text-muted/60">Indeterminado</span>}
                </p>
              </div>
              {contractData.paymentDay && (
                <div>
                  <p className="text-label text-muted">Dia de Pagamento</p>
                  <p className="text-foreground mt-1 text-sm">Todo dia {contractData.paymentDay}</p>
                </div>
              )}
              <div>
                <p className="text-label text-muted">Cadastrado em</p>
                <p className="text-foreground mt-1 text-sm">
                  {format(new Date(contractData.createdAt), "dd/MM/yyyy")}
                </p>
              </div>
            </div>
            {contractData.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-label text-muted mb-2">Observações</p>
                <p className="text-foreground text-sm whitespace-pre-wrap">{contractData.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Client info */}
          {contractData.clientId && (
            <div className="bg-surface rounded-xl border border-border p-6">
              <h2 className="text-h3 text-foreground mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Cliente
              </h2>
              <div className="space-y-3">
                <div>
                  <p className="text-label text-muted">Empresa</p>
                  <p className="text-foreground text-sm mt-1">{contractData.clientCompanyName}</p>
                </div>
                {contractData.clientResponsibleName && (
                  <div>
                    <p className="text-label text-muted">Responsável</p>
                    <p className="text-foreground text-sm mt-1">{contractData.clientResponsibleName}</p>
                  </div>
                )}
                {contractData.clientEmail && (
                  <div>
                    <p className="text-label text-muted">E-mail</p>
                    <a href={`mailto:${contractData.clientEmail}`} className="text-primary text-sm hover:underline mt-1 block">
                      {contractData.clientEmail}
                    </a>
                  </div>
                )}
                <Link
                  href={`/clientes/${contractData.clientId}`}
                  className="flex items-center gap-2 text-primary text-sm hover:underline mt-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver perfil do cliente
                </Link>
              </div>
            </div>
          )}

          {/* Drive file */}
          {contractData.driveFileId && (
            <div className="bg-surface rounded-xl border border-border p-6">
              <h2 className="text-h3 text-foreground mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Arquivo
              </h2>
              <p className="text-small text-muted">Contrato armazenado no Google Drive</p>
              <p className="text-xs font-mono text-muted/60 mt-2 break-all">{contractData.driveFileId}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
