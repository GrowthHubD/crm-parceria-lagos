import { eq, and } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { user, userTenant } from "./db/schema/users";
import { tenant } from "./db/schema/tenants";
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
  role: string; // role do user neste tenant: 'superadmin' | 'admin' | 'operator'
  userId: string;
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

  if (!session) throw new Error("UNAUTHENTICATED");

  // Cache de tenant context no KV — evita round-trip ao banco em toda navegação
  const kv = getTenantKV();
  const tenantCacheKey = kv ? `tenant:${session.user.id}` : null;
  if (kv && tenantCacheKey) {
    try {
      const cached = await kv.get(tenantCacheKey);
      if (cached) return JSON.parse(cached) as TenantContext;
    } catch { /* cache miss */ }
  }

  const tenantOverride = headers.get("x-tenant-id");

  // Override só vale se o user tem role 'superadmin' em ALGUM tenant
  // (tipicamente o GH platform owner). Sem essa checagem, qualquer user
  // autenticado pode forjar X-Tenant-Id e operar em tenants alheios desde
  // que algum row em user_tenant case (ex.: convidado num tenant secundário).
  let allowOverride = false;
  if (tenantOverride) {
    const [supercheck] = await db
      .select({ id: userTenant.id })
      .from(userTenant)
      .where(
        and(
          eq(userTenant.userId, session.user.id),
          eq(userTenant.role, "superadmin")
        )
      )
      .limit(1);
    allowOverride = Boolean(supercheck);
  }

  const useOverride = tenantOverride && allowOverride;

  const [row] = await db
    .select({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      isPlatformOwner: tenant.isPlatformOwner,
      role: userTenant.role,
    })
    .from(userTenant)
    .innerJoin(tenant, eq(userTenant.tenantId, tenant.id))
    .where(
      useOverride
        ? and(
            eq(userTenant.userId, session.user.id),
            eq(tenant.id, tenantOverride!)
          )
        : and(
            eq(userTenant.userId, session.user.id),
            eq(userTenant.isDefault, true)
          )
    )
    .limit(1);

  if (!row) {
    if (isDev) return { ...DEV_TENANT_CONTEXT, userId: session.user.id };
    throw new Error("NO_TENANT_ACCESS");
  }

  const ctx: TenantContext = {
    tenantId: row.tenantId,
    tenantSlug: row.tenantSlug,
    isPlatformOwner: row.isPlatformOwner,
    role: row.role,
    userId: session.user.id,
  };

  // Salva no KV pra próximas requests (30s TTL)
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
