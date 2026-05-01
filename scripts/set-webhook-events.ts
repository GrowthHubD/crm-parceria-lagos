import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const TOKEN = "e88c26aa-583f-4402-a2e9-7e612613af53";

async function main() {
  const r = await fetch("https://williphone.uazapi.com/webhook", {
    method: "POST",
    headers: { token: TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://linux-officials-will-colour.trycloudflare.com/api/webhooks/uazapi/v2",
      enabled: true,
      events: ["messages", "messages_update", "connection", "qr"],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    }),
  });
  console.log("status:", r.status);
  console.log(await r.text());
}
main().catch(console.error);
