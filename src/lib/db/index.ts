import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

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

function getDb(): DbInstance {
  if (!_db) {
    const client = postgres(process.env.DATABASE_URL!, {
      prepare: false, // exigido pelo Supabase transaction pooler (6543)
      max: 20, // dashboard AMS faz ~20 queries paralelas
      idle_timeout: 20,
      connect_timeout: 15,
      max_lifetime: 60 * 30, // 30min — evita conexões zumbis
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

// Proxy so all imports keep using `db.select(...)` without changes
export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type Database = typeof db;
