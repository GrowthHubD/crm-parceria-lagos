/**
 * Auth — camada de compatibilidade sobre Supabase Auth.
 *
 * Cache KV de 30s no getSession: elimina o round-trip a Supabase Auth em
 * requests consecutivos do mesmo usuário. Trade-off aceitável: sessões
 * revogadas continuam válidas por até 30s (janela pequena para SaaS).
 */

import { createSupabaseServer } from "./supabase/server";
import { cookies } from "next/headers";
import { db } from "./db";
import { user } from "./db/schema/users";
import { eq } from "drizzle-orm";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role?: string;
  jobTitle?: string | null;
  phone?: string | null;
  isActive?: boolean;
  image?: string | null;
}

export interface AppSession {
  user: SessionUser;
}

const CACHE_TTL_SECONDS = 30;

type CfCtx = { env?: { AUTH_CACHE?: KVNamespace } };
type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

function getAuthKV(): KVNamespace | null {
  try {
    const ctx = (globalThis as Record<symbol, CfCtx | undefined>)[
      Symbol.for("__cloudflare-context__")
    ];
    return ctx?.env?.AUTH_CACHE ?? null;
  } catch {
    return null;
  }
}

/** Deriva cache key do access_token do cookie (primeiros 64 chars são suficientes). */
async function getCacheKey(): Promise<string | null> {
  try {
    const jar = await cookies();
    // Supabase SSR usa sb-<ref>-auth-token (ou chunks .0/.1 se token grande)
    for (const c of jar.getAll()) {
      if (c.name.includes("-auth-token")) {
        // Tenta parse JSON (cookie completo), senão usa o valor cru (chunk)
        let token: string | null = null;
        try {
          const parsed = JSON.parse(c.value) as { access_token?: string };
          token = parsed?.access_token ?? null;
        } catch {
          token = c.value.length > 20 ? c.value : null;
        }
        if (token) return `auth:${token.slice(0, 64)}`;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Retorna a sessão ativa da request. Null se não autenticado.
 * Usa cache KV de 30s em CF Workers pra evitar round-trip ao Supabase Auth.
 */
async function getSession({ headers: _headers }: { headers?: Headers } = {}): Promise<AppSession | null> {
  const kv = getAuthKV();
  const cacheKey = kv ? await getCacheKey() : null;

  // Tenta cache KV primeiro
  if (kv && cacheKey) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) return JSON.parse(cached) as AppSession;
    } catch { /* cache miss — segue pro Supabase */ }
  }

  // Valida com Supabase Auth (round-trip externo)
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    if (error) {
      console.warn("[auth] getUser error:", {
        name: error.name,
        message: error.message,
        status: (error as { status?: number }).status,
      });
    }
    return null;
  }

  // Busca campos customizados em public.user (via Hyperdrive — rápido)
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.id, data.user.id))
    .limit(1);

  const session: AppSession = {
    user: {
      id: data.user.id,
      email: data.user.email ?? row?.email ?? "",
      name: row?.name ?? data.user.user_metadata?.name ?? data.user.email ?? "user",
      role: row?.role,
      jobTitle: row?.jobTitle ?? null,
      phone: row?.phone ?? null,
      isActive: row?.isActive ?? true,
      image: row?.image ?? null,
    },
  };

  // Armazena no KV pra próximas requests
  if (kv && cacheKey) {
    try {
      await kv.put(cacheKey, JSON.stringify(session), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* falha no cache não é crítica */ }
  }

  return session;
}

export const auth = {
  api: { getSession },
};

export type Session = AppSession;
