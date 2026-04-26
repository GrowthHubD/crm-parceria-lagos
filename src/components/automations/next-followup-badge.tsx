"use client";

import { Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

export interface NextFollowUpData {
  automationId: string;
  automationName: string;
  scheduledAt: string | Date;
  status: "pending" | "upcoming";
}

interface Props {
  data: NextFollowUpData | null;
  variant: "compact" | "full";
  className?: string;
}

/**
 * Badge reusável — mostra "Próximo follow-up: <nome> em ~<tempo>".
 *
 * - `compact`: ideal pra kanban card (1 linha, truncate, bem sutil).
 * - `full`: ideal pro header do CRM (prefix "Próximo:").
 *
 * Cor:
 *   - upcoming (agendado futuro)   → muted/primary
 *   - pending (log já agendado)    → warning se está atrasado, senão primary
 *   - null                         → não renderiza nada
 */
export function NextFollowUpBadge({ data, variant, className }: Props) {
  if (!data) return null;

  const scheduled = typeof data.scheduledAt === "string"
    ? new Date(data.scheduledAt)
    : data.scheduledAt;

  const now = new Date();
  const isLate = data.status === "pending" && scheduled.getTime() < now.getTime() - 60_000;
  const relative = formatDistanceToNow(scheduled, { locale: ptBR, addSuffix: false });

  const timing = scheduled.getTime() < now.getTime()
    ? isLate ? `atrasado ${relative}` : "agora"
    : `em ${relative}`;

  const color = isLate
    ? "text-warning"
    : data.status === "pending"
      ? "text-primary"
      : "text-muted";

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-1 text-xs truncate",
          color,
          className
        )}
        title={`Próximo follow-up: ${data.automationName} ${timing}`}
      >
        <Clock className="w-3 h-3 shrink-0" />
        <span className="truncate">
          <span className="font-medium">{data.automationName}</span>
          <span className="opacity-70"> · {timing}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5 text-xs", color, className)}>
      <Clock className="w-3.5 h-3.5 shrink-0" />
      <span>
        <span className="opacity-70">Próximo:</span>{" "}
        <span className="font-medium">{data.automationName}</span>
        <span className="opacity-70"> · {timing}</span>
      </span>
    </div>
  );
}
