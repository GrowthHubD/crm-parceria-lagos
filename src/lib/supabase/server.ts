import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase server client — usa cookies Next.js.
 * Deve ser criado DENTRO de cada request (não pode ser singleton).
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Next 13+ pode bloquear set em Server Components (só funciona em Server Actions/Route Handlers).
            // Ignorar silenciosamente — a request subsequente re-autentica.
          }
        },
      },
    }
  );
}
