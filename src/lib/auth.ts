/**
 * Auth — camada de compatibilidade sobre Supabase Auth.
 *
 * Migração de better-auth → Supabase Auth. Essa camada mantém:
 *   - `auth.api.getSession({ headers })` usado pelo getTenantContext + APIs
 *   - Shape da sessão similar (session.user.id/name/email/role)
 *
 * Quem cuida da sessão real: src/lib/supabase/{server,client,admin}.ts
 */

import { createSupabaseServer } from "./supabase/server";
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

/**
 * Retorna a sessão ativa da request. Null se não autenticado.
 * Faz merge de auth.users (Supabase) + public.user (campos customizados).
 */
async function getSession({ headers: _headers }: { headers?: Headers } = {}): Promise<AppSession | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Busca campos customizados em public.user
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.id, data.user.id))
    .limit(1);

  return {
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
}

// API compatível com o uso existente (auth.api.getSession({ headers }))
export const auth = {
  api: { getSession },
};

export type Session = AppSession;
