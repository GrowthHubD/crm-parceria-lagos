"use client";

/**
 * LeadFilters — barra de filtros COMPARTILHADA entre /pipeline e /crm.
 *
 * Mesmo critério de filtragem dos dois lados:
 *  - Tag       → leads (pipeline) e conversas cuja Lead vinculado tem essa tag (CRM)
 *  - Stage     → leads no stage X (pipeline) e conversas cuja Lead está nesse stage (CRM)
 *  - Classific → conversas com classificação X (CRM); leads cuja conversa vinculada tem classificação X (pipeline)
 *  - Funil     → escopo do tenant (mostrar só dados ligados a esse funil)
 *
 * Estado vive na URL via search params (?tag=ID&stage=ID&class=hot&pipeline=ID).
 * Compartilhável e persistente entre navegações.
 */

import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";

export interface FilterTag {
  id: string;
  name: string;
  color: string;
}

export interface FilterStage {
  id: string;
  name: string;
  color: string | null;
  pipelineId?: string;
}

export interface FilterFunnel {
  id: string;
  name: string;
}

export const CLASSIFICATION_OPTIONS = [
  { value: "hot", label: "Quente", color: "var(--color-error, #ef4444)" },
  { value: "warm", label: "Morno", color: "var(--color-warning, #f59e0b)" },
  { value: "cold", label: "Frio", color: "var(--color-info, #3b82f6)" },
  { value: "active_client", label: "Cliente Ativo", color: "var(--color-success, #22c55e)" },
  { value: "new", label: "Novo", color: "var(--color-muted, #94a3b8)" },
] as const;

export interface LeadFiltersValue {
  tagId: string | null;
  stageId: string | null;
  classification: string | null;
  pipelineId: string | null;
}

interface LeadFiltersProps {
  tags: FilterTag[];
  stages: FilterStage[];
  funnels?: FilterFunnel[];
  /**
   * Quais filtros mostrar. Por padrão todos.
   * Útil pra esconder funnel no /pipeline (já tem picker no header)
   * ou stage no CRM em layouts compactos.
   */
  show?: {
    tags?: boolean;
    stages?: boolean;
    classification?: boolean;
    funnel?: boolean;
  };
  /**
   * Como o componente lê/escreve estado.
   * - "url"     → useSearchParams + router.replace (default)
   * - "controlled" → usa props value/onChange
   */
  mode?: "url" | "controlled";
  value?: LeadFiltersValue;
  onChange?: (value: LeadFiltersValue) => void;
  className?: string;
  /** Texto que rotula a barra. Default: "Filtros". */
  label?: string;
}

const DEFAULT_VALUE: LeadFiltersValue = {
  tagId: null,
  stageId: null,
  classification: null,
  pipelineId: null,
};

export function useLeadFiltersFromUrl(): LeadFiltersValue {
  const sp = useSearchParams();
  return {
    tagId: sp.get("tag"),
    stageId: sp.get("stage"),
    classification: sp.get("class"),
    pipelineId: sp.get("pipeline"),
  };
}

export function buildLeadFiltersQuery(value: LeadFiltersValue): string {
  const params = new URLSearchParams();
  if (value.tagId) params.set("tagId", value.tagId);
  if (value.stageId) params.set("stageId", value.stageId);
  if (value.classification) params.set("classification", value.classification);
  if (value.pipelineId) params.set("pipelineId", value.pipelineId);
  return params.toString();
}

export function LeadFilters({
  tags,
  stages,
  funnels = [],
  show = { tags: true, stages: true, classification: true, funnel: false },
  mode = "url",
  value,
  onChange,
  className,
  label = "Filtros",
}: LeadFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlValue: LeadFiltersValue = {
    tagId: searchParams.get("tag"),
    stageId: searchParams.get("stage"),
    classification: searchParams.get("class"),
    pipelineId: searchParams.get("pipeline"),
  };

  const current: LeadFiltersValue = mode === "url" ? urlValue : value ?? DEFAULT_VALUE;

  const update = useCallback(
    (next: Partial<LeadFiltersValue>) => {
      const merged: LeadFiltersValue = { ...current, ...next };

      if (mode === "url") {
        const sp = new URLSearchParams(searchParams.toString());
        const set = (key: string, v: string | null) => {
          if (v) sp.set(key, v);
          else sp.delete(key);
        };
        set("tag", merged.tagId);
        set("stage", merged.stageId);
        set("class", merged.classification);
        set("pipeline", merged.pipelineId);
        const qs = sp.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      } else {
        onChange?.(merged);
      }
    },
    [current, mode, onChange, pathname, router, searchParams]
  );

  const clearAll = () => update({ tagId: null, stageId: null, classification: null, pipelineId: null });

  const hasActiveFilter =
    !!current.tagId || !!current.stageId || !!current.classification || !!current.pipelineId;

  const showTags = show.tags !== false && tags.length > 0;
  const showStages = show.stages !== false && stages.length > 0;
  const showClass = show.classification !== false;
  const showFunnel = show.funnel === true && funnels.length > 1;

  if (!showTags && !showStages && !showClass && !showFunnel) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap p-3 bg-surface rounded-xl border border-border",
        className
      )}
    >
      <div className="flex items-center gap-1.5 mr-1">
        <Filter className="w-3.5 h-3.5 text-muted" />
        <span className="text-xs font-medium text-muted uppercase tracking-wide">{label}</span>
      </div>

      {/* Funil */}
      {showFunnel && (
        <div className="w-44">
          <Select
            value={current.pipelineId ?? ""}
            onChange={(v) => update({ pipelineId: v || null })}
            placeholder="Todos os funis"
            options={[
              { value: "", label: "Todos os funis" },
              ...funnels.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        </div>
      )}

      {/* Stage dropdown */}
      {showStages && (
        <div className="w-44">
          <Select
            value={current.stageId ?? ""}
            onChange={(v) => update({ stageId: v || null })}
            placeholder="Todas etapas"
            options={[
              { value: "", label: "Todas as etapas" },
              ...stages.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
      )}

      {/* Classificação dropdown */}
      {showClass && (
        <div className="w-44">
          <Select
            value={current.classification ?? ""}
            onChange={(v) => update({ classification: v || null })}
            placeholder="Classificação"
            options={[
              { value: "", label: "Toda classificação" },
              ...CLASSIFICATION_OPTIONS.map((c) => ({ value: c.value, label: c.label })),
            ]}
          />
        </div>
      )}

      {/* Tag chips */}
      {showTags && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => update({ tagId: null })}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
              current.tagId === null
                ? "bg-primary text-white"
                : "text-muted hover:text-foreground hover:bg-surface-2"
            )}
          >
            Todas tags
          </button>
          {tags.map((tag) => {
            const active = current.tagId === tag.id;
            return (
              <button
                type="button"
                key={tag.id}
                onClick={() => update({ tagId: active ? null : tag.id })}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer",
                  active ? "text-white" : "text-muted hover:text-foreground hover:bg-surface-2"
                )}
                style={active ? { backgroundColor: tag.color } : {}}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: active ? "white" : tag.color }}
                />
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Limpar todos */}
      {hasActiveFilter && (
        <button
          type="button"
          onClick={clearAll}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
          title="Limpar filtros"
        >
          <X className="w-3.5 h-3.5" />
          Limpar
        </button>
      )}
    </div>
  );
}
