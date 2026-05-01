"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  GitBranch,
  FileText,
  DollarSign,
  MessageSquare,
  Users,
  Bot,
  Kanban,
  BookOpen,
  Settings,
  CalendarDays,
  SlidersHorizontal,
  ChevronsLeft,
  ChevronsRight,
  X,
  Zap,
  CheckSquare,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiSound } from "@/hooks/use-ui-sound";
import type { SystemModule, UserRole } from "@/types";

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  module: SystemModule;
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  allowedModules: SystemModule[];
  isPlatformOwner: boolean;
  userName: string;
  userRole: UserRole;
}

// Módulos CRM (visíveis para todos os tenants)
const CRM_MODULES: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard, module: "dashboard" },
  { title: "Pipeline", href: "/pipeline", icon: GitBranch, module: "pipeline" },
  { title: "CRM", href: "/crm", icon: MessageSquare, module: "crm" },
  { title: "Tarefas", href: "/tasks", icon: CheckSquare, module: "tasks" },
  { title: "Agenda", href: "/agenda", icon: CalendarDays, module: "agenda" },
  { title: "Automações", href: "/automations", icon: Zap, module: "automations" },
];

// Módulos AMS (exclusivos do tenant GH — is_platform_owner)
const AMS_MODULES: NavItem[] = [
  { title: "Contratos", href: "/contratos", icon: FileText, module: "contracts" },
  { title: "Financeiro", href: "/financeiro", icon: DollarSign, module: "financial" },
  { title: "Clientes", href: "/clientes", icon: Users, module: "clients" },
  { title: "Agente SDR", href: "/sdr", icon: Bot, module: "sdr" },
  { title: "Kanban", href: "/kanban", icon: Kanban, module: "kanban" },
  { title: "Blog", href: "/blog", icon: BookOpen, module: "blog" },
];

// Módulos de sistema (admin + config)
const SYSTEM_MODULES: NavItem[] = [
  { title: "Admin", href: "/admin/usuarios", icon: Settings, module: "admin" },
  { title: "Tenants", href: "/admin/tenants", icon: Building2, module: "tenants" },
  { title: "Configurações", href: "/configuracoes", icon: SlidersHorizontal, module: "configuracoes" },
];

// Módulos do parceiro revendedor (ex: Alexandre)
const PARTNER_MODULES: NavItem[] = [
  { title: "Meus Clientes", href: "/partner", icon: Users, module: "partner_clients" },
  { title: "Métricas", href: "/partner/metricas", icon: LayoutDashboard, module: "partner_metrics" },
];

const ROLE_LABELS: Record<UserRole, string> = {
  partner: "Sócio",
  manager: "Gerente",
  operational: "Operacional",
  superadmin: "Super Admin",
  partner_admin: "Parceiro",
  admin: "Administrador",
  operator: "Operador",
};

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
  allowedModules,
  isPlatformOwner,
  userName,
  userRole,
}: SidebarProps) {
  const pathname = usePathname();
  const { playSound } = useUiSound();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  // Filtrar módulos por allowedModules
  const visibleCrm = CRM_MODULES.filter((i) => allowedModules.includes(i.module));
  const visibleAms = isPlatformOwner
    ? AMS_MODULES.filter((i) => allowedModules.includes(i.module))
    : [];
  const visiblePartner = PARTNER_MODULES.filter((i) => allowedModules.includes(i.module));
  const visibleSystem = SYSTEM_MODULES.filter((i) => allowedModules.includes(i.module));

  const renderNavItem = (item: NavItem, idx: number) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={true}
        onClick={() => {
          if (!active) playSound("click");
          onMobileClose();
        }}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer group",
          "animate-slide-up",
          `stagger-${Math.min(idx + 1, 12)}`,
          active
            ? "bg-primary/10 text-primary"
            : "text-muted hover:text-foreground hover:bg-surface-2 hover:translate-x-0.5"
        )}
        title={collapsed ? item.title : undefined}
      >
        <Icon
          className={cn(
            "w-5 h-5 shrink-0 transition-all duration-200",
            active
              ? "text-primary"
              : "text-muted group-hover:text-foreground group-hover:scale-110"
          )}
        />
        {!collapsed && <span>{item.title}</span>}
      </Link>
    );
  };

  const renderGroupLabel = (label: string) => {
    if (collapsed) return null;
    return (
      <p className="px-3 pt-4 pb-1 text-label uppercase tracking-wider text-xs font-semibold text-muted/60">
        {label}
      </p>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[var(--topbar-height)] border-b border-border shrink-0">
        {!collapsed && (
          <Image
            src="/images/logo-full.png"
            alt="Growth Hub"
            width={140}
            height={30}
            className="brightness-0 invert"
          />
        )}
        {collapsed && (
          <Image
            src="/images/logo-icon.png"
            alt="Growth Hub"
            width={28}
            height={28}
            className="mx-auto"
          />
        )}

        {/* Mobile close */}
        <button
          onClick={onMobileClose}
          className="lg:hidden text-muted hover:text-foreground cursor-pointer transition-colors"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {/* Grupo CRM */}
        {visibleCrm.length > 0 && (
          <>
            {isPlatformOwner && renderGroupLabel("CRM")}
            {visibleCrm.map((item, idx) => renderNavItem(item, idx))}
          </>
        )}

        {/* Grupo AMS (somente tenant GH) */}
        {visibleAms.length > 0 && (
          <>
            {renderGroupLabel("Gestão")}
            {visibleAms.map((item, idx) => renderNavItem(item, visibleCrm.length + idx))}
          </>
        )}

        {/* Grupo Parceiro (revenda — Alexandre) */}
        {visiblePartner.length > 0 && (
          <>
            {renderGroupLabel("Parceria")}
            {visiblePartner.map((item, idx) =>
              renderNavItem(item, visibleCrm.length + visibleAms.length + idx)
            )}
          </>
        )}

        {/* Grupo Sistema */}
        {visibleSystem.length > 0 && (
          <>
            {renderGroupLabel("Sistema")}
            {visibleSystem.map((item, idx) =>
              renderNavItem(
                item,
                visibleCrm.length + visibleAms.length + visiblePartner.length + idx
              )
            )}
          </>
        )}
      </nav>

      {/* Footer: user info + collapse toggle */}
      <div className="border-t border-border px-3 py-3 shrink-0">
        {!collapsed && (
          <div className="mb-3 px-1">
            <p className="text-sm font-medium text-foreground truncate">{userName}</p>
            <p className="text-label mt-0.5">{ROLE_LABELS[userRole] ?? userRole}</p>
          </div>
        )}

        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex items-center gap-2 w-full px-2 py-2 rounded-lg text-muted hover:text-foreground hover:bg-surface-2 transition-colors duration-200 cursor-pointer text-sm"
          aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
        >
          {collapsed ? (
            <ChevronsRight className="w-4 h-4 mx-auto" />
          ) : (
            <>
              <ChevronsLeft className="w-4 h-4" />
              <span>Recolher</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:flex-col fixed left-0 top-0 bottom-0 z-30",
          "bg-surface/80 backdrop-blur-xl border-r border-border transition-all duration-200"
        )}
        style={{
          width: collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)",
        }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "lg:hidden fixed left-0 top-0 bottom-0 z-50",
          "bg-surface/90 backdrop-blur-xl border-r border-border w-[280px]",
          "transition-transform duration-200",
          mobileOpen ? "translate-x-0 animate-slide-in-left" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
