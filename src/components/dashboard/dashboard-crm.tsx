"use client";

import { GitBranch, MessageSquare, Zap, Users, TrendingUp, Clock } from "lucide-react";

interface StageStat {
  id: string;
  name: string;
  color: string | null;
  leads: number;
}

interface DashboardCrmProps {
  totalLeads: number;
  newLeadsThisMonth: number;
  convertedLeads: number;
  conversionRate: number;
  avgDaysInPipeline: number;
  stageStats: StageStat[];
  totalMessages: number;
  activeAutomations: number;
  pendingAutomationLogs: number;
}

export function DashboardCrm({
  totalLeads,
  newLeadsThisMonth,
  convertedLeads,
  conversionRate,
  avgDaysInPipeline,
  stageStats,
  totalMessages,
  activeAutomations,
  pendingAutomationLogs,
}: DashboardCrmProps) {

  const kpiCards = [
    {
      title: "Total de Leads",
      value: totalLeads,
      icon: Users,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Novos este mês",
      value: newLeadsThisMonth,
      icon: TrendingUp,
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      title: "Convertidos",
      value: convertedLeads,
      icon: GitBranch,
      color: "text-warning",
      bgColor: "bg-warning/10",
    },
    {
      title: "Taxa de Conversão",
      value: `${conversionRate.toFixed(1)}%`,
      icon: TrendingUp,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Mensagens",
      value: totalMessages,
      icon: MessageSquare,
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      title: "Automações Ativas",
      value: activeAutomations,
      icon: Zap,
      color: "text-warning",
      bgColor: "bg-warning/10",
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map((kpi) => (
          <div key={kpi.title} className="bg-surface border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg ${kpi.bgColor} flex items-center justify-center`}>
                <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
              </div>
            </div>
            <p className="text-xl font-bold text-foreground">{kpi.value}</p>
            <p className="text-xs text-muted mt-0.5">{kpi.title}</p>
          </div>
        ))}
      </div>

      {/* Funil visual */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Funil de Leads</h2>

        {stageStats.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">Nenhum lead no pipeline</p>
        ) : (
          <div className="space-y-2">
            {stageStats.map((stage, idx) => {
              const maxLeads = Math.max(...stageStats.map((s) => s.leads), 1);
              const pct = (stage.leads / maxLeads) * 100;
              return (
                <div key={stage.id} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <p className="text-xs font-medium text-foreground truncate">{stage.name}</p>
                  </div>
                  <div className="flex-1 h-7 bg-surface-2 rounded-lg overflow-hidden">
                    <div
                      className="h-full rounded-lg flex items-center px-2 transition-all duration-500"
                      style={{
                        width: `${Math.max(pct, 8)}%`,
                        backgroundColor: stage.color ?? "#6C5CE7",
                      }}
                    >
                      <span className="text-xs font-bold text-white">{stage.leads}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tempo médio no pipeline */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-muted" />
            <h2 className="text-sm font-semibold text-foreground">Tempo Médio no Pipeline</h2>
          </div>
          <p className="text-3xl font-bold text-foreground">
            {avgDaysInPipeline > 0 ? `${avgDaysInPipeline}` : "—"}
            <span className="text-sm font-normal text-muted ml-1">dias</span>
          </p>
          <p className="text-xs text-muted mt-1">Da criação até a conversão</p>
        </div>

        {/* Automações pendentes */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-muted" />
            <h2 className="text-sm font-semibold text-foreground">Automações</h2>
          </div>
          <p className="text-3xl font-bold text-foreground">
            {activeAutomations}
            <span className="text-sm font-normal text-muted ml-1">ativas</span>
          </p>
          {pendingAutomationLogs > 0 && (
            <p className="text-xs text-warning mt-1">{pendingAutomationLogs} execuções pendentes</p>
          )}
        </div>
      </div>
    </div>
  );
}
