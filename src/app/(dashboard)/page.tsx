import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { contract } from "@/lib/db/schema/contracts";
import { client } from "@/lib/db/schema/clients";
import { lead, pipelineStage } from "@/lib/db/schema/pipeline";
import { financialTransaction } from "@/lib/db/schema/financial";
import { crmMessage } from "@/lib/db/schema/crm";
import { automation, automationLog } from "@/lib/db/schema/automations";
import { eq, and, gte, lte, desc, count, sum, lt, asc, sql } from "drizzle-orm";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { DashboardCrm } from "@/components/dashboard/dashboard-crm";
import type { UserRole } from "@/types";
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, subYears, getYear, differenceInDays } from "date-fns";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  let tenantCtx;
  try {
    tenantCtx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  const userRole = tenantCtx.role as UserRole;
  const canView = await checkPermission(tenantCtx.userId, userRole, "dashboard", "view", tenantCtx);
  if (!canView) redirect("/");

  // Se NÃO é platform owner → Dashboard CRM
  if (!tenantCtx.isPlatformOwner) {
    return renderCrmDashboard(tenantCtx.tenantId);
  }

  // Se É platform owner → Dashboard AMS (financeiro)
  return renderAmsDashboard(tenantCtx.userId, userRole);
}

// ============================================
// Dashboard CRM (tenants Lagos)
// ============================================

async function renderCrmDashboard(tenantId: string) {
  const now = new Date();
  const monthStart = startOfMonth(now);

  const [
    totalLeadsRow,
    newLeadsRow,
    convertedLeadsRow,
    stageStats,
    totalMessagesRow,
    activeAutomationsRow,
    pendingLogsRow,
    convertedLeadsList,
  ] = await Promise.all([
    // Total leads do tenant
    db.select({ count: count() }).from(lead).where(eq(lead.tenantId, tenantId)),

    // Leads novos este mês
    db.select({ count: count() }).from(lead)
      .where(and(eq(lead.tenantId, tenantId), gte(lead.createdAt, monthStart))),

    // Leads convertidos
    db.select({ count: count() }).from(lead)
      .where(and(eq(lead.tenantId, tenantId), eq(lead.isConverted, true))),

    // Leads por stage
    db.select({
      stageId: pipelineStage.id,
      stageName: pipelineStage.name,
      stageColor: pipelineStage.color,
      stageOrder: pipelineStage.order,
      leadCount: count(lead.id),
    })
      .from(pipelineStage)
      .leftJoin(lead, eq(lead.stageId, pipelineStage.id))
      .where(eq(pipelineStage.tenantId, tenantId))
      .groupBy(pipelineStage.id, pipelineStage.name, pipelineStage.color, pipelineStage.order)
      .orderBy(asc(pipelineStage.order)),

    // Total mensagens (via conversations do tenant)
    db.select({ count: count() }).from(crmMessage),

    // Automações ativas
    db.select({ count: count() }).from(automation)
      .where(and(eq(automation.tenantId, tenantId), eq(automation.isActive, true))),

    // Logs pendentes
    db.select({ count: count() }).from(automationLog)
      .where(eq(automationLog.status, "pending")),

    // Leads convertidos com data para calcular tempo médio
    db.select({ createdAt: lead.createdAt, updatedAt: lead.updatedAt }).from(lead)
      .where(and(eq(lead.tenantId, tenantId), eq(lead.isConverted, true)))
      .limit(100),
  ]);

  const totalLeads = totalLeadsRow[0]?.count ?? 0;
  const convertedLeads = convertedLeadsRow[0]?.count ?? 0;
  const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

  // Tempo médio no pipeline (dias entre criação e conversão)
  const avgDaysInPipeline = convertedLeadsList.length > 0
    ? Math.round(
        convertedLeadsList.reduce(
          (sum, l) => sum + differenceInDays(l.updatedAt, l.createdAt),
          0
        ) / convertedLeadsList.length
      )
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-h1 text-foreground">Dashboard</h1>
        <p className="text-muted mt-1">Visão geral do CRM</p>
      </div>

      <DashboardCrm
        totalLeads={totalLeads}
        newLeadsThisMonth={newLeadsRow[0]?.count ?? 0}
        convertedLeads={convertedLeads}
        conversionRate={conversionRate}
        avgDaysInPipeline={avgDaysInPipeline}
        stageStats={stageStats.map((s) => ({
          id: s.stageId,
          name: s.stageName,
          color: s.stageColor,
          leads: s.leadCount,
        }))}
        totalMessages={totalMessagesRow[0]?.count ?? 0}
        activeAutomations={activeAutomationsRow[0]?.count ?? 0}
        pendingAutomationLogs={pendingLogsRow[0]?.count ?? 0}
      />
    </div>
  );
}

// ============================================
// Dashboard AMS (tenant GH — financeiro)
// ============================================

async function renderAmsDashboard(userId: string, userRole: UserRole) {
  const now = new Date();
  const yearNum = getYear(now);

  const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(now), "yyyy-MM-dd");
  const yearStart = format(startOfYear(now), "yyyy-MM-dd");
  const yearEnd = format(endOfYear(now), "yyyy-MM-dd");
  const prevMonthStart = format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd");
  const prevMonthEnd = format(endOfMonth(subMonths(now, 1)), "yyyy-MM-dd");
  const prevYearStart = format(startOfYear(subYears(now, 1)), "yyyy-MM-dd");
  const prevYearEnd = format(endOfYear(subYears(now, 1)), "yyyy-MM-dd");
  const prevYearSameMonthStart = format(startOfMonth(subYears(now, 1)), "yyyy-MM-dd");
  const prevYearSameMonthEnd = format(endOfMonth(subYears(now, 1)), "yyyy-MM-dd");
  const today = format(now, "yyyy-MM-dd");

  const [
    monthIncomeRow,
    monthExpensesRow,
    pendingRow,
    overdueRow,
    yearTotalRow,
    yearReceivedRow,
    yearPendingRow,
    prevYearTotalRow,
    prevMonthIncomeRow,
    prevYearSameMonthRow,
    activeContractsRow,
    recentClients,
    stagesWithLeads,
    clientContracts,
  ] = await Promise.all([
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"), eq(financialTransaction.status, "paid"),
        gte(financialTransaction.transactionDate, monthStart), lte(financialTransaction.transactionDate, monthEnd))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "expense"), eq(financialTransaction.status, "paid"),
        gte(financialTransaction.transactionDate, monthStart), lte(financialTransaction.transactionDate, monthEnd))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"), eq(financialTransaction.status, "pending"))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"), eq(financialTransaction.status, "overdue"))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"),
        gte(financialTransaction.transactionDate, yearStart), lte(financialTransaction.transactionDate, yearEnd))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"), eq(financialTransaction.status, "paid"),
        gte(financialTransaction.transactionDate, yearStart), lte(financialTransaction.transactionDate, yearEnd))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"), eq(financialTransaction.status, "pending"),
        gte(financialTransaction.transactionDate, yearStart), lte(financialTransaction.transactionDate, yearEnd))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"), eq(financialTransaction.status, "paid"),
        gte(financialTransaction.transactionDate, prevYearStart), lte(financialTransaction.transactionDate, prevYearEnd))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"), eq(financialTransaction.status, "paid"),
        gte(financialTransaction.transactionDate, prevMonthStart), lte(financialTransaction.transactionDate, prevMonthEnd))),
    db.select({ total: sum(financialTransaction.amount) }).from(financialTransaction)
      .where(and(eq(financialTransaction.type, "income"), eq(financialTransaction.status, "paid"),
        gte(financialTransaction.transactionDate, prevYearSameMonthStart), lte(financialTransaction.transactionDate, prevYearSameMonthEnd))),
    db.select({ mrr: sum(contract.monthlyValue), count: count() }).from(contract)
      .where(eq(contract.status, "active")),
    db.select({ id: client.id, companyName: client.companyName, responsibleName: client.responsibleName, createdAt: client.createdAt })
      .from(client).orderBy(desc(client.createdAt)).limit(5),
    db.select({
      stageId: pipelineStage.id,
      stageName: pipelineStage.name,
      stageOrder: pipelineStage.order,
      leadCount: count(lead.id),
    }).from(pipelineStage).leftJoin(lead, eq(lead.stageId, pipelineStage.id))
      .groupBy(pipelineStage.id, pipelineStage.name, pipelineStage.order)
      .orderBy(asc(pipelineStage.order)),
    db.select({ clientId: contract.clientId, mrr: contract.monthlyValue })
      .from(contract).where(eq(contract.status, "active")),
  ]);

  const monthIncome = Number(monthIncomeRow[0]?.total ?? 0);
  const monthExpenses = Number(monthExpensesRow[0]?.total ?? 0);
  const monthProfit = monthIncome - monthExpenses;
  const pending = Number(pendingRow[0]?.total ?? 0);
  const overdue = Number(overdueRow[0]?.total ?? 0);
  const yearTotal = Number(yearTotalRow[0]?.total ?? 0);
  const yearReceived = Number(yearReceivedRow[0]?.total ?? 0);
  const yearPending = Number(yearPendingRow[0]?.total ?? 0);

  const prevYearTotal = Number(prevYearTotalRow[0]?.total ?? 0);
  const prevMonthIncome = Number(prevMonthIncomeRow[0]?.total ?? 0);
  const prevYearSameMonth = Number(prevYearSameMonthRow[0]?.total ?? 0);

  const yoyGrowth = prevYearTotal > 0 ? ((yearReceived - prevYearTotal) / prevYearTotal) * 100 : null;
  const momGrowth = prevMonthIncome > 0 ? ((monthIncome - prevMonthIncome) / prevMonthIncome) * 100 : null;
  const vsLastYear = prevYearSameMonth > 0 ? ((monthIncome - prevYearSameMonth) / prevYearSameMonth) * 100 : null;

  const totalMrr = Number(activeContractsRow[0]?.mrr ?? 0);
  const activeContractCount = activeContractsRow[0]?.count ?? 0;
  const ticketMedio = activeContractCount > 0 ? totalMrr / activeContractCount : 0;
  const profitMargin = monthIncome > 0 ? (monthProfit / monthIncome) * 100 : 0;
  const revenuePerHour = monthIncome / 160;

  const maxClientMrr = clientContracts.length > 0
    ? Math.max(...clientContracts.map((c) => Number(c.mrr ?? 0)))
    : 0;
  const concentration = totalMrr > 0 ? (maxClientMrr / totalMrr) * 100 : 0;

  const FUNNEL_EXCLUDE = ["ganho", "perdido", "won", "lost"];
  const funnelStages = stagesWithLeads
    .filter((s) => !FUNNEL_EXCLUDE.some((x) => s.stageName.toLowerCase().includes(x)))
    .map((s) => ({ id: s.stageId, name: s.stageName, leads: s.leadCount }));

  const totalLeads = stagesWithLeads.reduce((acc, s) => acc + s.leadCount, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-h1 text-foreground">Dashboard</h1>
        <p className="text-muted mt-1">Visão consolidada das operações da Growth Hub</p>
      </div>

      <DashboardClient
        monthly={{ income: monthIncome, expenses: monthExpenses, profit: monthProfit, pending, overdue }}
        yearly={{ total: yearTotal, received: yearReceived, pending: yearPending, year: yearNum, yoyGrowth, momGrowth, vsLastYear }}
        business={{ ticketMedio, momGrowth, revenuePerHour, profitMargin, concentration, totalMrr, activeContracts: activeContractCount }}
        funnelStages={funnelStages}
        totalLeads={totalLeads}
        recentClients={recentClients.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
      />
    </div>
  );
}
