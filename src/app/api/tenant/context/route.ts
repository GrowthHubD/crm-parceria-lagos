import { NextRequest, NextResponse } from "next/server";
import { getTenantContext, getDevSession, DEV_TENANT_CONTEXT } from "@/lib/tenant";
import { getUserModules } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { DEFAULT_PERMISSIONS } from "@/types";
import type { UserRole } from "@/types";

const isDev = process.env.NODE_ENV === "development";

export async function GET(request: NextRequest) {
  try {
    let session = await auth.api.getSession({ headers: request.headers }).catch(() => null);

    // Dev bypass
    if (!session && isDev) {
      session = await getDevSession();
    }

    if (!session) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    let tenantCtx = DEV_TENANT_CONTEXT;
    let modules = DEFAULT_PERMISSIONS["partner"].modules;

    try {
      tenantCtx = await getTenantContext(request.headers);
      const userRole = tenantCtx.role as UserRole;
      modules = await getUserModules(tenantCtx.userId, userRole, tenantCtx);
    } catch {
      if (!isDev) return NextResponse.json({ error: "NO_TENANT_ACCESS" }, { status: 403 });
      // Em dev: usa mock + todos os módulos do partner
    }

    return NextResponse.json({
      tenantId: tenantCtx.tenantId,
      tenantSlug: tenantCtx.tenantSlug,
      isPlatformOwner: tenantCtx.isPlatformOwner,
      role: tenantCtx.role,
      modules,
      userName: session.user.name,
      userImage: session.user.image ?? null,
    });
  } catch {
    return NextResponse.json({ error: "NO_TENANT_ACCESS" }, { status: 403 });
  }
}
