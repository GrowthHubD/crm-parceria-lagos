import { createClient } from "@supabase/supabase-js";

/**
 * Supabase admin client — usa SERVICE_ROLE_KEY.
 * **NUNCA** usar em client components — bypass de RLS.
 */
let _admin: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return _admin;
}
