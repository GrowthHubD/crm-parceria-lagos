/**
 * Next.js instrumentation hook — roda uma vez no server boot.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * Só importa o ticker em runtime Node.js (evita warning "Module not found: net"
 * durante build edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Import lazy dentro do if pra webpack não tentar resolver no edge build
    await import("./instrumentation-node");
  }
}
