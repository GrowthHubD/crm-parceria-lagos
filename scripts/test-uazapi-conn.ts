import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const BASE = "https://williphone.uazapi.com";
const TOKEN = "e88c26aa-583f-4402-a2e9-7e612613af53";

async function tryEndpoint(path: string, headers: Record<string, string>, method = "GET", body?: unknown) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    console.log(`${method} ${path} [${Object.keys(headers).join(",")}]: ${r.status}`);
    if (t.length > 0) console.log(t.slice(0, 300));
    console.log("---");
  } catch (e) {
    console.log(`${path}: err ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  // Vários estilos de auth
  console.log("=== auth: token header ===");
  await tryEndpoint("/instance/status", { token: TOKEN });
  console.log("=== auth: Bearer (já tentei) ===");
  // /instance/status pode precisar do instance_id na query?
  console.log("=== /instance/status?instance_id=... ===");
  await tryEndpoint(`/instance/status?instance_id=horizoniabotsmorolanumber`, { token: TOKEN });
  console.log("=== /webhook/find ===");
  await tryEndpoint("/webhook/find", { token: TOKEN });
}
main().catch(console.error);
