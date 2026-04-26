import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const BASE = process.env.UAZAPI_BASE_URL!;
const TOKEN = process.env.UAZAPI_ADMIN_TOKEN!;

async function main() {
  const candidates = ["/instance/all", "/instance/list", "/instances", "/instance"];
  for (const path of candidates) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        headers: { adminToken: TOKEN, token: TOKEN, "Content-Type": "application/json" },
      });
      const t = await r.text();
      console.log(`GET ${path}: ${r.status}`);
      if (r.status === 200) {
        console.log(t.slice(0, 1500));
        console.log("---");
      }
    } catch (e) {
      console.log(`${path}: err ${e instanceof Error ? e.message : e}`);
    }
  }
}
main().catch(console.error);
