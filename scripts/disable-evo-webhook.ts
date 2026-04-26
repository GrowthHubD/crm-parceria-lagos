/**
 * Desativa o webhook da instância no Evolution (stop flood de eventos).
 * Uso: npx tsx scripts/disable-evo-webhook.ts [instanceName]
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const INSTANCE = process.argv[2] ?? "Helio";

async function main() {
  const BASE = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const KEY = process.env.EVOLUTION_API_KEY;
  if (!BASE || !KEY) {
    console.error("no env");
    process.exit(1);
  }

  const res = await fetch(`${BASE}/webhook/set/${INSTANCE}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhook: {
        enabled: false,
        url: "",
        events: [],
      },
    }),
  });
  console.log(`HTTP ${res.status}`);
  console.log(await res.text());
}
main().catch(console.error);
