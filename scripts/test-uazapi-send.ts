/**
 * Testa diferentes formatos de body pra POST /send/text na Uazapi v2.
 * Identifica qual o formato correto.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const BASE = "https://williphone.uazapi.com";
const TOKEN = "e88c26aa-583f-4402-a2e9-7e612613af53";
const PHONE = "5500000000000"; // FAKE — só pra ver erro de validação dos campos, não vai entregar

async function tryBody(label: string, body: Record<string, unknown>) {
  try {
    const r = await fetch(`${BASE}/send/text`, {
      method: "POST",
      headers: { token: TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    console.log(`${label}: ${r.status} ${t.slice(0, 200)}`);
  } catch (e) {
    console.log(`${label}: err ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  await tryBody("phone+message", { phone: PHONE, message: "teste 1" });
  await tryBody("number+text", { number: PHONE, text: "teste 2" });
  await tryBody("number+message", { number: PHONE, message: "teste 3" });
  await tryBody("phone+text", { phone: PHONE, text: "teste 4" });
  await tryBody("to+message", { to: PHONE, message: "teste 5" });
  await tryBody("to+text", { to: PHONE, text: "teste 6" });
}
main().catch(console.error);
