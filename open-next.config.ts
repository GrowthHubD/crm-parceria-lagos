import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext config pra Cloudflare Workers/Pages.
 *
 * Substitui o runtime serverful do Next por edge-compatible.
 * - Incremental Cache: usa R2 (configure binding `INC_CACHE_BUCKET` no wrangler)
 * - Tag Cache: também R2
 * - Queue: usa Cloudflare Queues (binding `MAIN_QUEUE`)
 *
 * Pra início, deixamos defaults — sem cache R2 nem queue. Funciona pra dev e
 * pra cargas pequenas. Quando crescer, ativa os adapters R2 + Queue.
 */
export default defineCloudflareConfig({
  // Sem incremental cache custom — usa o default in-memory da request
  // (ok pra Next 16 com fetch caching mínimo no nosso uso)
});
