import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { cache } from "react";

import * as tenants from "./schema/tenants";
import * as users from "./schema/users";
import * as clients from "./schema/clients";
import * as contracts from "./schema/contracts";
import * as pipeline from "./schema/pipeline";
import * as financial from "./schema/financial";
import * as crm from "./schema/crm";
import * as kanban from "./schema/kanban";
import * as sdr from "./schema/sdr";
import * as blog from "./schema/blog";
import * as notifications from "./schema/notifications";
import * as settings from "./schema/settings";
import * as automations from "./schema/automations";

const schema = {
  ...tenants,
  ...users,
  ...clients,
  ...contracts,
  ...pipeline,
  ...financial,
  ...crm,
  ...kanban,
  ...sdr,
  ...blog,
  ...notifications,
  ...settings,
  ...automations,
};

type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

let _db: DbInstance | null = null;

function isCloudflareWorker(): boolean {
  return typeof navigator !== "undefined" &&
    (navigator as Navigator & { userAgent?: string }).userAgent === "Cloudflare-Workers";
}

/**
 * Resolve a connection string. Em CF Workers, prefere o binding HYPERDRIVE
 * (pool de conexões na borda — elimina cold-start TCP). Fallback pra
 * DATABASE_URL quando rodando local ou se Hyperdrive não tá ligado.
 *
 * Usa globalThis diretamente — require() não existe em CF Workers (ESM).
 */
function resolveConnectionString(): string {
  try {
    type CfCtx = { env?: { HYPERDRIVE?: { connectionString?: string } } };
    const ctx = (globalThis as Record<symbol, CfCtx | undefined>)[
      Symbol.for("__cloudflare-context__")
    ];
    if (ctx?.env?.HYPERDRIVE?.connectionString) return ctx.env.HYPERDRIVE.connectionString;
  } catch { /* não tá em CF Worker */ }
  return process.env.DATABASE_URL!;
}

function makeDb(): DbInstance {
  const client = postgres(resolveConnectionString(), {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    max_lifetime: 60 * 30,
    fetch_types: false,
  });
  return drizzle(client, { schema });
}

/**
 * Em CF Workers, `React.cache()` deduplica chamadas dentro de UM SÓ request:
 * - Server Component que faz Promise.all([db.q1, db.q2, ...db.q8]) → todas
 *   compartilham 1 cliente (não estoura limite de 6 sockets simultâneos).
 * - Próxima request → React.cache cria cliente fresh (sem socket morto).
 *
 * Em Node local (dev), `React.cache` ainda funciona mas como o module-scoped
 * `_db` também tá disponível, mantém singleton pra performance entre requests.
 */
const getCachedDb = cache((): DbInstance => makeDb());

function getDb(): DbInstance {
  if (isCloudflareWorker()) return getCachedDb();
  if (!_db) _db = makeDb();
  return _db;
}

// Proxy so all imports keep using `db.select(...)` without changes
export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type Database = typeof db;
