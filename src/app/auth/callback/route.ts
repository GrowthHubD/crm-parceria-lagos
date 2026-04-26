/**
 * Supabase Auth callback — troca o `code` do magic link por uma sessão.
 *
 * Chamado quando cliente clica no magic link enviado pelo email:
 *   https://app.../auth/callback?code=XXX&next=/onboarding/whatsapp
 *
 * Sem `next`, vai pro dashboard.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
      );
    }
  } catch {
    return NextResponse.redirect(new URL("/login?error=callback_failed", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
