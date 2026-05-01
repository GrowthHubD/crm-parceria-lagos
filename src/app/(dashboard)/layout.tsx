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
  // Inicializa do sessionStorage em renderização lazy — evita flash de "Carregando..."
  // ao trocar de aba (next.js client-side nav re-mount pode acontecer em alguns casos).
  const [tenantCtx, setTenantCtx] = useState<TenantContext | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      // Pega qualquer cache de tenant-ctx — se houver vários (raro), o primeiro serve
      // (o useEffect abaixo valida e re-busca se a sessão mudou).
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k?.startsWith("tenant-ctx:")) {
          const v = sessionStorage.getItem(k);
          if (v) return JSON.parse(v) as TenantContext;
        }
      }
    } catch { /* ignore */ }
    return null;
  });

  // Redirecionar pro login apenas em produção
  useEffect(() => {
    if (!isPending && !session && !isDev) {
      router.push("/login");
    }
  }, [session, isPending, router]);

  // Buscar tenant context — cache em sessionStorage pra evitar re-fetch em
  // toda navegação client-side (Next App Router preserva layout entre pages,
  // mas hard reload + abas múltiplas refazem fetch).
  useEffect(() => {
    if (!session && !isDev) return;

    const cacheKey = session?.user?.id ? `tenant-ctx:${session.user.id}` : null;
    if (cacheKey) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          setTenantCtx(JSON.parse(cached));
          return;
        }
      } catch { /* sessionStorage indisponível — segue pro fetch */ }
    }

    fetch("/api/tenant/context")
      .then((res) => {
        if (!res.ok) throw new Error("NO_TENANT");
        return res.json();
      })
      .then((ctx) => {
        if (cacheKey) {
          try { sessionStorage.setItem(cacheKey, JSON.stringify(ctx)); } catch { /* quota / disabled */ }
        }
        setTenantCtx(ctx);
      })
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
