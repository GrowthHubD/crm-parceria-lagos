import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const TUNNEL = process.argv[2];
const INSTANCE = process.argv[3] ?? "Helio";

if (!TUNNEL) {
  console.error("Usage: npx tsx scripts/update-webhook.ts <https://xxx.trycloudflare.com> [instanceName]");
  process.exit(1);
}

async function main() {
  const BASE = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const KEY = process.env.EVOLUTION_API_KEY;
  if (!BASE || !KEY) { console.error("no env"); process.exit(1); }

  const webhookUrl = `${TUNNEL.replace(/\/$/, "")}/api/webhooks/evolution`;

  const res = await fetch(`${BASE}/webhook/set/${INSTANCE}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: true,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    }),
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);
  console.log(`\n✓ Webhook da instância "${INSTANCE}" agora aponta pra:\n  ${webhookUrl}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
