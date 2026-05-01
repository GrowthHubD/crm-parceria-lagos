/**
 * Configura o webhook da instância Uazapi pra apontar pro tunnel local.
 * Uso: npx tsx scripts/set-uazapi-webhook.ts <tunnel_url>
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const TUNNEL = process.argv[2];
if (!TUNNEL) {
  console.error("Uso: npx tsx scripts/set-uazapi-webhook.ts <https://xxx.trycloudflare.com>");
  process.exit(1);
}

const BASE = "https://williphone.uazapi.com";
const TOKEN = "e88c26aa-583f-4402-a2e9-7e612613af53";

async function main() {
  const webhookUrl = `${TUNNEL.replace(/\/$/, "")}/api/webhooks/uazapi/v2`;

  // Tenta /webhook/set
  const candidates = [
    { path: "/webhook/set", body: { webhook_url: webhookUrl, enabled: true } },
    { path: "/webhook/set", body: { url: webhookUrl, enabled: true } },
    { path: "/webhook", body: { url: webhookUrl, enabled: true }, method: "POST" },
    { path: "/instance/webhook", body: { webhook_url: webhookUrl } },
  ];

  for (const c of candidates) {
    try {
      const r = await fetch(`${BASE}${c.path}`, {
        method: c.method ?? "POST",
        headers: { token: TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(c.body),
      });
      const t = await r.text();
      console.log(`POST ${c.path} body=${JSON.stringify(c.body).slice(0, 80)} → ${r.status}`);
      console.log(t.slice(0, 300));
      console.log("---");
      if (r.status === 200 || r.status === 201) {
        console.log(`\n✓ Webhook configurado em ${c.path} → ${webhookUrl}`);
        return;
      }
    } catch (e) {
      console.log(`${c.path}: err ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log("\n✗ Nenhum endpoint de webhook funcionou");
}
main().catch(console.error);
