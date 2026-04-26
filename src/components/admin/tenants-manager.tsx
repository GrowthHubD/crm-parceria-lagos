"use client";

import { useState } from "react";
import { Building2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { WhatsAppConnect } from "@/components/crm/whatsapp-connect";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  isPlatformOwner: boolean;
  status: string;
  uazapiInstanceId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TenantsManagerProps {
  initialTenants: Tenant[];
}

export function TenantsManager({ initialTenants }: TenantsManagerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Gestão de Tenants</h1>
        <p className="text-muted mt-1">Gerencie os tenants da plataforma Growth Hub</p>
      </div>

      <div className="space-y-3">
        {initialTenants.map((t) => (
          <div key={t.id} className="bg-surface border border-border rounded-xl overflow-hidden">
            {/* Header */}
            <div
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface-2/50 transition-colors"
              onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted">{t.slug}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {t.isPlatformOwner && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
                    Platform Owner
                  </span>
                )}
                <span
                  className={cn(
                    "px-2 py-0.5 text-xs font-medium rounded-full",
                    t.status === "active" ? "bg-success/10 text-success" : "bg-error/10 text-error"
                  )}
                >
                  {t.status}
                </span>
                {expandedId === t.id ? (
                  <ChevronUp className="w-4 h-4 text-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted" />
                )}
              </div>
            </div>

            {/* Expanded content */}
            {expandedId === t.id && (
              <div className="px-4 pb-4 border-t border-border pt-4">
                <WhatsAppConnect tenantId={t.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
