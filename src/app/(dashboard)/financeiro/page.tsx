import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { financialTransaction, financialConfig } from "@/lib/db/schema/financial";
import { user, userTenant } from "@/lib/db/schema/users";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { FinancialSummary } from "@/components/financeiro/financial-summary";
import { TransactionList } from "@/components/financeiro/transaction-list";
import type { UserRole } from "@/types";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const metadata: Metadata = { title: "Financeiro" };

export default async function FinanceiroPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;

  let tenantCtx;
  try {
    tenantCtx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  const [canView, canEdit, canDelete] = await Promise.all([
    checkPermission(session.user.id, userRole, "financial", "view", tenantCtx),
    checkPermission(session.user.id, userRole, "financial", "edit", tenantCtx),
    checkPermission(session.user.id, userRole, "financial", "delete", tenantCtx),
  ]);

  if (!canView) redirect("/");

  const tenantId = tenantCtx.tenantId;

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");

  const [transactions, config, partners] = await Promise.all([
    db
      .select()
      .from(financialTransaction)
      .where(
        and(
          eq(financialTransaction.tenantId, tenantId),
          gte(financialTransaction.transactionDate, monthStart),
          lte(financialTransaction.transactionDate, monthEnd)
        )
      )
      .orderBy(desc(financialTransaction.transactionDate)),
    db
      .select()
      .from(financialConfig)
      .where(eq(financialConfig.tenantId, tenantId))
      .orderBy(desc(financialConfig.updatedAt))
      .limit(1),
    db
      .select({ id: user.id })
      .from(user)
      .innerJoin(userTenant, eq(userTenant.userId, user.id))
      .where(
        and(
          eq(userTenant.tenantId, tenantId),
          eq(user.role, "partner"),
          eq(user.isActive, true)
        )
      ),
  ]);

  const cfg = config[0];
  const partnerSharePct = cfg ? Number(cfg.partnerSharePercentage) : 30;
  const companyReservePct = cfg ? Number(cfg.companyReservePercentage) : 10;
  const revenueGoal = cfg?.revenueGoal ? Number(cfg.revenueGoal) : null;

  const totalIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + Number(t.amount), 0);

  const serialize = (t: typeof transactions[0]) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    category: t.category,
    amount: String(t.amount),
    transactionDate: t.transactionDate,
    billingType: t.billingType,
    status: t.status,
    dueDate: t.dueDate ?? null,
    notes: t.notes ?? null,
  });

  const incomeTransactions = transactions.filter((t) => t.type === "income").map(serialize);
  const expenseTransactions = transactions.filter((t) => t.type === "expense").map(serialize);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-h1 text-foreground">Financeiro</h1>
        <p className="text-muted mt-1">
          Resultado de {format(now, "MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      <FinancialSummary
        totalIncome={totalIncome}
        totalExpenses={totalExpenses}
        partnerSharePct={partnerSharePct}
        companyReservePct={companyReservePct}
        partnerCount={partners.length}
        isPartner={userRole === "partner"}
        revenueGoal={revenueGoal}
      />

      {/* Receitas */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-4">Lançamentos Financeiros</h2>
        <TransactionList
          initialTransactions={incomeTransactions}
          typeFixed="income"
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </div>

      {/* Despesas */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-4">Despesas</h2>
        <TransactionList
          initialTransactions={expenseTransactions}
          typeFixed="expense"
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </div>
    </div>
  );
}
