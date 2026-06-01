import { eq, and, inArray, or, asc } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { user, userTenant } from "./db/schema/users";
import { tenant } from "./db/schema/tenants";
import { readOverrideCookie, verifyOverride } from "./tenant-override";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

type CfCtx = { env?: { AUTH_CACHE?: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> } } };

function getTenantKV() {
  try {
    const ctx = (globalThis as Record<symbol, CfCtx | undefined>)[Symbol.for("__cloudflare-context__")];
    return ctx?.env?.AUTH_CACHE ?? null;
  } catch { return null; }
}

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  isPlatformOwner: boolean;
  isPartner: boolean;
  role: string; // role do user neste tenant: 'superadmin' | 'admin' | 'operator' | 'manager' | 'partner_admin'
  userId: string;
}

/**
 * Erro de auth com status HTTP anexado. Antes `getTenantContext` lançava
 * `Error("UNAUTHENTICATED")` genérico e o catch das rotas convertia em 500.
 * Usuário via 500 e o cliente Inbox.tsx engolia em catch silencioso.
 * Agora rotas detectam `e instanceof AuthError` e retornam o statusCode certo.
 */
export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Helper: o user pode gerenciar clientes (criar/listar/resetar senha)?
 * Critérios:
 *   1. role superadmin → sempre
 *   2. role partner_admin → sempre (já é dono do tenant partner)
 *   3. role manager E tenant.is_partner OR tenant.is_platform_owner → sim
 *      (gerente de partner/platform delegando o trabalho de onboarding)
 *   4. demais → não
 */
export function canManagePartnerClients(ctx: TenantContext): boolean {
  if (ctx.role === "superadmin" || ctx.role === "partner_admin") return true;
  if (ctx.role === "manager" && (ctx.isPartner || ctx.isPlatformOwner)) return true;
  return false;
}

/**
 * Tenants que este contexto pode VER/operar — fonte única da regra de
 * visibilidade cross-tenant. Antes estava duplicada em /crm/page.tsx e
 * /api/crm/route.ts, e as rotas de conversa individual NÃO usavam (filtravam
 * só por ctx.tenantId), causando 404 ao platform owner abrir conversa de
 * outro tenant que aparecia na lista. Centralizar evita essa divergência.
 *
 *   - platform owner (GH)        → todos os tenants ativos (inbox cross-tenant)
 *   - superadmin / admin         → o próprio + filhos (partnerId = self)
 *   - demais (operator/manager/…)→ apenas o próprio tenant
 *
 * Para usuários normais o resultado é `[ctx.tenantId]` — comportamento idêntico
 * ao escopo singular anterior, sem regressão/escalonamento.
 */
export async function getVisibleTenants(
  ctx: TenantContext
): Promise<{ id: string; name: string; slug: string }[]> {
  if (ctx.isPlatformOwner) {
    return db
      .select({ id: tenant.id, name: tenant.name, slug: tenant.slug })
      .from(tenant)
      .where(eq(tenant.status, "active"))
      .orderBy(asc(tenant.name));
  }
  if (ctx.role === "superadmin" || ctx.role === "admin") {
    return db
      .select({ id: tenant.id, name: tenant.name, slug: tenant.slug })
      .from(tenant)
      .where(or(eq(tenant.id, ctx.tenantId), eq(tenant.partnerId, ctx.tenantId)))
      .orderBy(asc(tenant.name));
  }
  // Usuário não-elevado vê APENAS o próprio tenant — retorna em memória, sem
  // round-trip ao banco (o branch antigo era um SELECT cujo resultado só podia
  // ser [ctx.tenantId]). Corta 1 query por request no hot path do CRM, já que
  // getVisibleTenantIds roda em toda rota de conversa. `name` = slug é
  // suficiente (a lista só vira dropdown quando há >1 tenant, i.e. elevado).
  return [{ id: ctx.tenantId, name: ctx.tenantSlug, slug: ctx.tenantSlug }];
}

/** Conveniência: só os ids dos tenants visíveis (para `inArray` em WHERE). */
export async function getVisibleTenantIds(ctx: TenantContext): Promise<string[]> {
  return (await getVisibleTenants(ctx)).map((t) => t.id);
}

// Bypass de auth pra dev local. Exige duas condições — NODE_ENV=development
// E ALLOW_DEV_AUTH_BYPASS=true — pra impedir que setar NODE_ENV em prod por
// engano abra a porta. ALLOW_DEV_AUTH_BYPASS NUNCA deve existir em secrets CF.
const isDev =
  process.env.NODE_ENV === "development" &&
  process.env.ALLOW_DEV_AUTH_BYPASS === "true";

/**
 * Retorna o primeiro superadmin do banco para uso em dev mode.
 * Se o banco estiver vazio, retorna um mock hardcoded.
 */
export async function getDevSession(): Promise<{
  user: { id: string; name: string; email: string; role: string; image?: string | null };
} | null> {
  if (!isDev) return null;

  try {
    const [row] = await db
      .select({ id: user.id, name: user.name, email: user.email, role: user.role, image: user.image })
      .from(user)
      .where(eq(user.role, "partner"))
      .limit(1);

    if (row) return { user: row };
  } catch {
    // DB indisponível — cai no mock abaixo
  }

  // Mock hardcoded para dev sem banco
  return {
    user: {
      id: "dev-user-id",
      name: "Dev User",
      email: "dev@localhost",
      role: "partner",
      image: null,
    },
  };
}

/**
 * Contexto de tenant mockado para dev sem banco configurado.
 */
export const DEV_TENANT_CONTEXT: TenantContext = {
  tenantId: "dev-tenant-id",
  tenantSlug: "gh",
  isPlatformOwner: true,
  isPartner: false,
  role: "partner",
  userId: "dev-user-id",
};

/**
 * Extrai o tenant context da request.
 *
 * Estratégia de resolução (em ordem):
 * 1. Header X-Tenant-Id (superadmin cross-tenant override)
 * 2. Tenant padrão do user (isDefault = true em user_tenant)
 *
 * Em dev mode: se não houver sessão, usa o superadmin automaticamente.
 * Lança erro se não houver sessão ou tenant válido.
 */
export async function getTenantContext(
  headers: ReadonlyHeaders
): Promise<TenantContext> {
  let session = await auth.api.getSession({ headers }).catch(() => null);

  // Dev bypass: usar superadmin quando sem sessão
  if (!session && isDev) {
    const dev = await getDevSession();
    session = dev as unknown as typeof session;
  }

  if (!session) {
    // Log diagnóstico — distingue "sem cookie no header" de "cookie presente
    // mas inválido". Crítico pra diagnóstico de 401 em prod.
    const cookieHdr = headers.get("cookie") ?? "";
    console.warn("[tenant] UNAUTHENTICATED", {
      hasCookieHeader: cookieHdr.length > 0,
      sbAuthCookies: cookieHdr.split(";").filter((c) => c.includes("-auth-token")).length,
      isDev,
    });
    throw new AuthError(401, "UNAUTHENTICATED");
  }

  // Cookie override tem precedência sobre header. Cookie é httpOnly assinado
  // (signOverride/verifyOverride em ./tenant-override) e acompanha todo fetch
  // automaticamente — assim a UI de Tenant Switcher não precisa modificar 25+
  // routes que já lêem getTenantContext.
  let tenantOverride = headers.get("x-tenant-id");
  const cookieToken = readOverrideCookie(headers.get("cookie"));
  if (cookieToken) {
    const verified = await verifyOverride(cookieToken, session.user.id);
    if (verified) tenantOverride = verified.tenantId;
  }

  // Cache só vale para o lookup default (sem override). Override é dinâmico
  // por request — cachear ele faria com que a próxima request retornasse o
  // tenant errado.
  const kv = !tenantOverride ? getTenantKV() : null;
  const tenantCacheKey = kv ? `tenant:${session.user.id}` : null;
  if (kv && tenantCacheKey) {
    try {
      const cached = await kv.get(tenantCacheKey);
      if (cached) return JSON.parse(cached) as TenantContext;
    } catch { /* cache miss */ }
  }

  // ── Override path ──────────────────────────────────────────────────────
  // Quem pode trocar de tenant via X-Tenant-Id:
  // - superadmin: qualquer tenant (suporte cross-tenant)
  // - partner_admin: somente sub-clientes onde tenant.partnerId == seu home tenant
  //
  // Nenhum dos dois precisa ter row em user_tenant pro tenant alvo —
  // a autorização vem do papel + (no caso do parceiro) da relação partnerId.
  if (tenantOverride) {
    const elevatedRows = await db
      .select({ tenantId: userTenant.tenantId, role: userTenant.role })
      .from(userTenant)
      .where(
        and(
          eq(userTenant.userId, session.user.id),
          inArray(userTenant.role, ["superadmin", "partner_admin"])
        )
      );

    const isSuperadmin = elevatedRows.some((r) => r.role === "superadmin");
    const partnerHomeTenantId =
      elevatedRows.find((r) => r.role === "partner_admin")?.tenantId ?? null;

    if (isSuperadmin) {
      const [t] = await db
        .select({
          id: tenant.id,
          slug: tenant.slug,
          isPlatformOwner: tenant.isPlatformOwner,
          isPartner: tenant.isPartner,
        })
        .from(tenant)
        .where(eq(tenant.id, tenantOverride))
        .limit(1);

      if (t) {
        return {
          tenantId: t.id,
          tenantSlug: t.slug,
          isPlatformOwner: t.isPlatformOwner,
          isPartner: t.isPartner,
          role: "superadmin",
          userId: session.user.id,
        };
      }
    }

    if (partnerHomeTenantId) {
      const [t] = await db
        .select({
          id: tenant.id,
          slug: tenant.slug,
          isPlatformOwner: tenant.isPlatformOwner,
          isPartner: tenant.isPartner,
        })
        .from(tenant)
        .where(
          and(
            eq(tenant.id, tenantOverride),
            eq(tenant.partnerId, partnerHomeTenantId)
          )
        )
        .limit(1);

      if (t) {
        return {
          tenantId: t.id,
          tenantSlug: t.slug,
          isPlatformOwner: t.isPlatformOwner,
          isPartner: t.isPartner,
          role: "partner_admin",
          userId: session.user.id,
        };
      }
    }

    // Override pedido mas não autorizado / tenant inexistente.
    // Cai no lookup default abaixo (em vez de retornar 403 silencioso).
  }

  // ── Default path ───────────────────────────────────────────────────────
  // Pega TODAS as rows pra escolher de forma determinística — múltiplos
  // is_default=true pode acontecer (estado legado) e .limit(1) sem ordem
  // poderia pegar o tenant errado.
  const allRows = await db
    .select({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      isPlatformOwner: tenant.isPlatformOwner,
      isPartner: tenant.isPartner,
      role: userTenant.role,
      isDefault: userTenant.isDefault,
      createdAt: userTenant.createdAt,
    })
    .from(userTenant)
    .innerJoin(tenant, eq(userTenant.tenantId, tenant.id))
    .where(eq(userTenant.userId, session.user.id));

  let row: (typeof allRows)[number] | undefined;
  if (allRows.length === 0) {
    row = undefined;
  } else {
    const defaults = allRows.filter((r) => r.isDefault);
    const elevated = allRows.some((r) => r.role === "superadmin" || r.role === "partner_admin");

    if (defaults.length === 1) {
      row = defaults[0];
    } else if (elevated) {
      row =
        allRows.find((r) => r.isPlatformOwner) ??
        [...allRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    } else {
      row = [...allRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    }
  }

  if (!row) {
    if (isDev) return { ...DEV_TENANT_CONTEXT, userId: session.user.id };
    throw new AuthError(403, "NO_TENANT_ACCESS");
  }

  const ctx: TenantContext = {
    tenantId: row.tenantId,
    tenantSlug: row.tenantSlug,
    isPlatformOwner: row.isPlatformOwner,
    isPartner: row.isPartner,
    role: row.role,
    userId: session.user.id,
  };

  if (kv && tenantCacheKey) {
    try {
      await kv.put(tenantCacheKey, JSON.stringify(ctx), { expirationTtl: 30 });
    } catch { /* falha no cache não é crítica */ }
  }

  return ctx;
}

/**
 * Helper simplificado quando só precisa do tenantId.
 */
export async function getTenantId(headers: ReadonlyHeaders): Promise<string> {
  const ctx = await getTenantContext(headers);
  return ctx.tenantId;
}
