import { auth } from "./auth";
import { getDevSession } from "./tenant";

const isDev = process.env.NODE_ENV === "development";

/**
 * Retorna a sessão do usuário (server-side). Em dev sem sessão,
 * retorna o mock hardcoded do seed (`dev-user-id` vinculado a GH como superadmin).
 */
export async function getServerSession() {
  const real = await auth.api.getSession().catch(() => null);
  if (real) return real;

  if (isDev) {
    const dev = await getDevSession();
    return dev as unknown as Awaited<ReturnType<typeof auth.api.getSession>>;
  }

  return null;
}
