import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { sdrAgent, sdrMetricSnapshot } from "@/lib/db/schema/sdr";
import { eq, desc, asc } from "drizzle-orm";
import { SdrDashboard } from "@/components/sdr/sdr-dashboard";
import type { UserRole } from "@/types";

export const metadata: Metadata = { title: "Agente SDR" };

export default async function SdrPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;

  const [canView, canEdit] = await Promise.all([
    checkPermission(session.user.id, userRole, "sdr", "view"),
    checkPermission(session.user.id, userRole, "sdr", "edit"),
  ]);

  if (!canView) redirect("/");

  const [agents, metrics] = await Promise.all([
    db.select().from(sdrAgent).orderBy(asc(sdrAgent.name)),
    db
      .select({
        id: sdrMetricSnapshot.id,
        agentId: sdrMetricSnapshot.agentId,
        agentName: sdrAgent.name,
        periodStart: sdrMetricSnapshot.periodStart,
        periodEnd: sdrMetricSnapshot.periodEnd,
        leadsProspected: sdrMetricSnapshot.leadsProspected,
        newLeads: sdrMetricSnapshot.newLeads,
        totalMessagesSent: sdrMetricSnapshot.totalMessagesSent,
        messagesPerMeeting: sdrMetricSnapshot.messagesPerMeeting,
        responseRate: sdrMetricSnapshot.responseRate,
        meetingsScheduled: sdrMetricSnapshot.meetingsScheduled,
        meetingsShowRate: sdrMetricSnapshot.meetingsShowRate,
        meetingsNoShow: sdrMetricSnapshot.meetingsNoShow,
        meetingsRescheduled: sdrMetricSnapshot.meetingsRescheduled,
        meetingsCancelled: sdrMetricSnapshot.meetingsCancelled,
        leadsRefused: sdrMetricSnapshot.leadsRefused,
        leadsQualified: sdrMetricSnapshot.leadsQualified,
        firstResponseTimeAvgMin: sdrMetricSnapshot.firstResponseTimeAvgMin,
        conversionRate: sdrMetricSnapshot.conversionRate,
        mrrGenerated: sdrMetricSnapshot.mrrGenerated,
        arrGenerated: sdrMetricSnapshot.arrGenerated,
        revenueAttributed: sdrMetricSnapshot.revenueAttributed,
        dropoffStageData: sdrMetricSnapshot.dropoffStageData,
      })
      .from(sdrMetricSnapshot)
      .leftJoin(sdrAgent, eq(sdrMetricSnapshot.agentId, sdrAgent.id))
      .orderBy(desc(sdrMetricSnapshot.periodStart)),
  ]);

  const serialized = metrics.map((m) => ({
    ...m,
    agentName: m.agentName ?? null,
    messagesPerMeeting: m.messagesPerMeeting ?? "0",
    responseRate: m.responseRate ?? "0",
    meetingsShowRate: m.meetingsShowRate ?? "0",
    firstResponseTimeAvgMin: m.firstResponseTimeAvgMin ?? "0",
    conversionRate: m.conversionRate ?? "0",
    mrrGenerated: m.mrrGenerated ?? "0",
    arrGenerated: m.arrGenerated ?? "0",
    revenueAttributed: m.revenueAttributed ?? "0",
    dropoffStageData: (m.dropoffStageData as Record<string, number> | null) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Agente SDR</h1>
        <p className="text-muted mt-1">Métricas de prospecção e conversão</p>
      </div>

      <SdrDashboard
        agents={agents}
        initialMetrics={serialized}
        canEdit={canEdit}
      />
    </div>
  );
}
