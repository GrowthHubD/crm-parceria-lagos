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
import { cookies } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getUserModules } from "@/lib/permissions";
import { OVERRIDE_COOKIE_NAME, verifyOverride } from "@/lib/tenant-override";
import type { UserRole } from "@/types";

export async function GET(_request: NextRequest) {
  // 1) Auth via cliente SSR (usa o JWT do cookie do user)
  let userId: string;
  let authEmail: string | null = null;
  let authName: string | null = null;
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    userId = data.user.id;
    authEmail = data.user.email ?? null;
    authName = (data.user.user_metadata?.name as string | undefined) ?? null;
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "AUTH_ERROR", debugMessage: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  // 2) Lookups subsequentes via service_role (bypass RLS — o user já tá autenticado)
  const admin = getSupabaseAdmin();

  let { data: userRowRaw, error: userErr } = await admin
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

  // Self-heal: user autenticado em Supabase Auth mas sem linha em public.user
  // (provisioning antigo silenciava esse erro). Cria automaticamente.
  if (!userRowRaw && authEmail) {
    const { data: created, error: createErr } = await admin
      .from("user")
      .insert({
        id: userId,
        name: authName ?? authEmail,
        email: authEmail,
        emailVerified: true,
        role: "admin",
        isActive: true,
      })
      .select("id, name, image")
      .single();
    if (createErr) {
      return NextResponse.json(
        { error: "USER_BACKFILL_FAILED", debugMessage: createErr.message },
        { status: 500 }
      );
    }
    userRowRaw = created;
  }
  if (!userRowRaw) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }
  const userRow = userRowRaw as { id: string; name: string; image: string | null };

  // 3) Lookup tenant binding — pega TODOS os vínculos e escolhe o melhor
  // (default primeiro, depois mais recente). Tolera duplicatas de is_default=true
  // que aconteciam em provisioning antigo rodado múltiplas vezes pro mesmo user.
  const { data: utRows, error: utErr } = await admin
    .from("user_tenant")
    .select("id, role, is_default, created_at, tenant:tenant_id(id, slug, is_platform_owner, is_partner)")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (utErr) {
    return NextResponse.json(
      { error: "TENANT_LOOKUP_ERROR", debugMessage: utErr.message },
      { status: 500 }
    );
  }

  type UtRow = {
    id: string;
    role: string;
    is_default: boolean;
    created_at: string;
    tenant: { id: string; slug: string; is_platform_owner: boolean; is_partner: boolean } | null;
  };

  const rows = (utRows ?? []) as UtRow[];
  const validRows = rows.filter((r) => r.tenant !== null);

  // Lógica determinística de seleção:
  //  1. Se tem exatamente 1 row com is_default=true E tenant válido → usa ele
  //  2. Se user é superadmin/partner_admin com vários vínculos → prefere
  //     is_platform_owner=true (tenant GH) ou is_partner indireto (não temos
  //     a flag aqui, mas isPlatformOwner cobre o GH)
  //  3. Senão → mais ANTIGO (created_at ASC) — primeiro tenant onde foi
  //     vinculado, mais provável de ser o "verdadeiro" home
  const elevated = validRows.some((r) => r.role === "superadmin" || r.role === "partner_admin");

  let chosen: UtRow | undefined;
  const singleDefault = validRows.filter((r) => r.is_default);
  if (singleDefault.length === 1) {
    chosen = singleDefault[0];
  } else if (elevated) {
    chosen = validRows.find((r) => r.tenant?.is_platform_owner) ?? validRows[validRows.length - 1];
  } else {
    // mais antigo primeiro (created_at ASC)
    chosen = [...validRows].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )[0];
  }

  if (!chosen || !chosen.tenant) {
    return NextResponse.json({ error: "NO_TENANT_ACCESS" }, { status: 403 });
  }

  // Self-heal: garante exatamente 1 default (o escolhido) — evita o erro
  // "multiple rows returned" em queries .maybeSingle() futuras.
  const defaults = rows.filter((r) => r.is_default);
  const needsNormalize = defaults.length !== 1 || defaults[0]?.id !== chosen.id;
  if (needsNormalize) {
    await admin
      .from("user_tenant")
      .update({ is_default: false })
      .eq("user_id", userId);
    await admin
      .from("user_tenant")
      .update({ is_default: true })
      .eq("id", chosen.id);
  }

  // ── Override de tenant via cookie gh-tenant-override (switcher) ─────────
  // Sem isto, o gate sempre devolvia o tenant DEFAULT e a sidebar/switcher
  // divergiam do tenant que getTenantContext aplica nas rotas de dados após um
  // switch. Autorização: superadmin → qualquer; partner_admin → home + filhos.
  // O home prefere a row em tenant is_partner=true (mesmo critério do
  // /api/tenant/switch) — senão um partner_admin com >1 vínculo poderia ter o
  // override recusado aqui e a sidebar cair no default. Best-effort: cai no default.
  let effectiveRole: string = chosen.role;
  let effectiveTenant = chosen.tenant;
  try {
    const overrideToken = (await cookies()).get(OVERRIDE_COOKIE_NAME)?.value;
    if (overrideToken) {
      const verified = await verifyOverride(overrideToken, userId);
      if (verified) {
        const isSuper = rows.some((r) => r.role === "superadmin");
        const partnerHome =
          (rows.find((r) => r.role === "partner_admin" && r.tenant?.is_partner) ??
            rows.find((r) => r.role === "partner_admin"))?.tenant?.id ?? null;
        const { data: tgt } = await admin
          .from("tenant")
          .select("id, slug, is_platform_owner, is_partner, partner_id")
          .eq("id", verified.tenantId)
          .maybeSingle();
        const tt = tgt as
          | { id: string; slug: string; is_platform_owner: boolean; is_partner: boolean; partner_id: string | null }
          | null;
        const allowed =
          !!tt &&
          (isSuper || (!!partnerHome && (tt.id === partnerHome || tt.partner_id === partnerHome)));
        if (tt && allowed) {
          effectiveTenant = {
            id: tt.id,
            slug: tt.slug,
            is_platform_owner: tt.is_platform_owner,
            is_partner: tt.is_partner,
          };
          effectiveRole = isSuper ? "superadmin" : "partner_admin";
        }
      }
    }
  } catch { /* override best-effort — cai no default */ }

  const utRow = {
    role: effectiveRole,
    tenant: effectiveTenant,
  };

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
      isPartner: t.is_partner,
      role: utRow.role,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "MODULES_ERROR", debugMessage: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  // 5) Lista de tenants acessíveis pelo user (pra Tenant Switcher)
  //    - superadmin: todos
  //    - partner_admin: home + sub-clientes (partner_id = home)
  //    - demais: só os tenants em user_tenant
  type AvailableTenantRow = {
    id: string;
    slug: string;
    is_platform_owner: boolean;
    is_partner: boolean;
  };
  let availableTenantsRaw: AvailableTenantRow[] = [];

  const isSuperadmin = validRows.some((r) => r.role === "superadmin");
  const partnerHomeTenantId =
    validRows.find((r) => r.role === "partner_admin")?.tenant?.id ?? null;

  if (isSuperadmin) {
    const { data } = await admin
      .from("tenant")
      .select("id, slug, is_platform_owner, is_partner")
      .order("slug");
    availableTenantsRaw = (data ?? []) as AvailableTenantRow[];
  } else if (partnerHomeTenantId) {
    const { data } = await admin
      .from("tenant")
      .select("id, slug, is_platform_owner, is_partner")
      .or(`id.eq.${partnerHomeTenantId},partner_id.eq.${partnerHomeTenantId}`)
      .order("slug");
    availableTenantsRaw = (data ?? []) as AvailableTenantRow[];
  } else {
    availableTenantsRaw = validRows
      .map((r) => r.tenant!)
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        is_platform_owner: t.is_platform_owner,
        is_partner: t.is_partner,
      }));
  }

  const availableTenants = availableTenantsRaw.map((r) => ({
    id: r.id,
    slug: r.slug,
    isPlatformOwner: r.is_platform_owner,
    isPartner: r.is_partner,
  }));

  return NextResponse.json({
    tenantId: t.id,
    tenantSlug: t.slug,
    isPlatformOwner: t.is_platform_owner,
    isPartner: t.is_partner,
    role: utRow.role,
    modules,
    userName: userRow.name,
    userImage: userRow.image ?? null,
    availableTenants,
  });
}
