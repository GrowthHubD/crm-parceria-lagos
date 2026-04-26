/**
 * Testa evolutionGetMediaBase64 direto contra a API pra entender o erro.
 * Usa o ID de uma mensagem de áudio real recente.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

async function main() {
  const BASE = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const KEY = process.env.EVOLUTION_API_KEY;
  if (!BASE || !KEY) { console.error("no env"); process.exit(1); }

  const INSTANCE = "Helio";

  // 1) Pega a última mensagem de áudio via /chat/findMessages
  console.log("→ Buscando últimas mensagens do Helio...");
  const findRes = await fetch(`${BASE}/chat/findMessages/${INSTANCE}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ where: {}, limit: 20 }),
  });
  if (!findRes.ok) {
    console.error("findMessages failed:", findRes.status, (await findRes.text()).slice(0, 200));
    process.exit(1);
  }
  const findData = await findRes.json();
  const messages = Array.isArray(findData) ? findData : (findData.messages?.records ?? findData.records ?? []);
  console.log(`  → ${messages.length} msgs retornadas`);

  // 2) Acha um áudio
  const audio = messages.find((m: Record<string, unknown>) => {
    const inner = m.message as Record<string, unknown> | undefined;
    return inner?.audioMessage;
  });
  if (!audio) {
    console.log("Nenhuma msg de áudio nas últimas 20.");
    console.log("Sample:", JSON.stringify(messages[0], null, 2).slice(0, 600));
    process.exit(0);
  }
  console.log("  → audio encontrado, id=" + ((audio as Record<string, unknown>).key as Record<string, unknown> | undefined)?.id);

  // 3) Tenta getBase64FromMediaMessage passando a msg completa
  console.log("\n→ POST /chat/getBase64FromMediaMessage/Helio com { message: <audio>, convertToMp4: false }...");
  const r = await fetch(`${BASE}/chat/getBase64FromMediaMessage/${INSTANCE}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ message: audio, convertToMp4: false }),
  });
  const text = await r.text();
  console.log(`  HTTP ${r.status}`);
  console.log(`  body (200 chars): ${text.slice(0, 200)}`);

  if (r.ok) {
    const data = JSON.parse(text);
    console.log(`  base64 length: ${data.base64?.length ?? "NONE"}`);
    console.log(`  mimetype: ${data.mimetype ?? "NONE"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
