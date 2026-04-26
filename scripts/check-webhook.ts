import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

async function main() {
  const BASE = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const KEY = process.env.EVOLUTION_API_KEY;
  if (!BASE || !KEY) {
    console.error("no env");
    process.exit(1);
  }

  const res = await fetch(`${BASE}/webhook/find/Helio`, {
    headers: { apikey: KEY },
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
