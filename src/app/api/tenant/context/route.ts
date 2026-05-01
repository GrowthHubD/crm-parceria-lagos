/**
 * /api/tenant/context — gate do dashboard. Retorna tenant + user + módulos
 * permitidos.
 *
 * Auth: cliente SSR (lê cookie do user, valida JWT). Bypass de RLS pra os
 * lookups subsequentes via cliente admin (service_role) — seguro pq o user
 * já foi autenticado e os campos retornados são apenas o que o gate precisa.
 *
 * Por que não Drizzle: postgres-js abre socket TCP que é instável em
 * cold-start no CF Worker (Worker exception 1101 intermitente). PostgREST
 * via HTTPS não tem esse problema.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getUserModules } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET(_request: NextRequest) {
  // 1) Auth via cliente SSR (usa o JWT do cookie do user)
  let userId: string;
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    userId = data.user.id;
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "AUTH_ERROR", debugMessage: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  // 2) Lookups subsequentes via service_role (bypass RLS — o user já tá autenticado)
  const admin = getSupabaseAdmin();

  const { data: userRowRaw, error: userErr } = await admin
    .from("user")
    .select("id, name, image")
    .eq("id", userId)
    .maybeSingle();

  if (userErr) {
    return NextResponse.json(
      { error: "USER_LOOKUP_ERROR", debugMessage: userErr.message },
      { status: 500 }
    );
  }
  if (!userRowRaw) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }
  const userRow = userRowRaw as { id: string; name: string; image: string | null };

  // 3) Lookup tenant binding (default) com embedded join PostgREST
  const { data: utRowRaw, error: utErr } = await admin
    .from("user_tenant")
    .select("role, tenant:tenant_id(id, slug, is_platform_owner)")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();

  if (utErr) {
    return NextResponse.json(
      { error: "TENANT_LOOKUP_ERROR", debugMessage: utErr.message },
      { status: 500 }
    );
  }

  if (!utRowRaw) {
    return NextResponse.json({ error: "NO_TENANT_ACCESS" }, { status: 403 });
  }

  const utRow = utRowRaw as {
    role: string;
    tenant: { id: string; slug: string; is_platform_owner: boolean } | null;
  };

  if (!utRow.tenant) {
    return NextResponse.json({ error: "NO_TENANT_ACCESS" }, { status: 403 });
  }

  const t = utRow.tenant;
  const role = utRow.role as UserRole;

  // 4) Resolver módulos (superadmin/partner retornam imediato — sem DB)
  let modules;
  try {
    modules = await getUserModules(userId, role, {
      userId,
      tenantId: t.id,
      tenantSlug: t.slug,
      isPlatformOwner: t.is_platform_owner,
      role: utRow.role,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "MODULES_ERROR", debugMessage: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenantId: t.id,
    tenantSlug: t.slug,
    isPlatformOwner: t.is_platform_owner,
    role: utRow.role,
    modules,
    userName: userRow.name,
    userImage: userRow.image ?? null,
  });
}
