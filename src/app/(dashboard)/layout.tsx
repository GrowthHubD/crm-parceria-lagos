"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Loader2 } from "lucide-react";
import type { SystemModule, UserRole } from "@/types";

const isDev = process.env.NODE_ENV === "development";

interface TenantContext {
  isPlatformOwner: boolean;
  tenantSlug: string;
  role: string;
  modules: SystemModule[];
  userName: string;
  userImage: string | null;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [tenantCtx, setTenantCtx] = useState<TenantContext | null>(null);

  // Redirecionar pro login apenas em produção
  useEffect(() => {
    if (!isPending && !session && !isDev) {
      router.push("/login");
    }
  }, [session, isPending, router]);

  // Buscar tenant context — funciona sem sessão em dev (API faz fallback)
  useEffect(() => {
    if (!session && !isDev) return;

    fetch("/api/tenant/context")
      .then((res) => {
        if (!res.ok) throw new Error("NO_TENANT");
        return res.json();
      })
      .then(setTenantCtx)
      .catch(() => {
        if (!isDev) router.push("/login");
      });
  }, [session, router]);

  if ((isPending && !isDev) || !tenantCtx) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-muted text-small">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell
      allowedModules={tenantCtx.modules}
      isPlatformOwner={tenantCtx.isPlatformOwner}
      tenantSlug={tenantCtx.tenantSlug}
      userName={tenantCtx.userName}
      userImage={tenantCtx.userImage}
      userRole={tenantCtx.role as UserRole}
    >
      {children}
    </DashboardShell>
  );
}
