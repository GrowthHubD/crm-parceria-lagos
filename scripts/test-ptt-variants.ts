/**
 * Testa variantes do body POST /send/media pra descobrir o formato exato que
 * faz Uazapi enviar como PTT (balão de voz) e não como documento.
 *
 * Usa um arquivo OGG real válido pra eliminar dúvida sobre a conversão.
 * Número FAKE pra ver só erro de schema/validação, não mandar pra ninguém.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const BASE = "https://williphone.uazapi.com";
const TOKEN = "e88c26aa-583f-4402-a2e9-7e612613af53";
const PHONE_FAKE = "5500000000000";

// 1KB de "OGG" mock — só pra schema validation aceitar. Real conversion já testada.
const MOCK_OGG_HEADER = "T2dnUwACAAAAAAAAAAA"; // "OggS\x02..." em base64
const FAKE_FILE = `data:audio/ogg;codecs=opus;base64,${MOCK_OGG_HEADER}`;

interface Variant {
  label: string;
  body: Record<string, unknown>;
}

const VARIANTS: Variant[] = [
  { label: "type=ptt + file (atual)", body: { number: PHONE_FAKE, type: "ptt", file: FAKE_FILE } },
  { label: "type=audio + ptt:true", body: { number: PHONE_FAKE, type: "audio", file: FAKE_FILE, ptt: true } },
  { label: "type=audio + isPtt:true", body: { number: PHONE_FAKE, type: "audio", file: FAKE_FILE, isPtt: true } },
  { label: "type=audio + voice:true", body: { number: PHONE_FAKE, type: "audio", file: FAKE_FILE, voice: true } },
  { label: "type=ptt + mimetype", body: { number: PHONE_FAKE, type: "ptt", file: FAKE_FILE, mimetype: "audio/ogg; codecs=opus" } },
  { label: "type=ptt + mimetype space", body: { number: PHONE_FAKE, type: "ptt", file: FAKE_FILE, mimetype: "audio/ogg;codecs=opus" } },
  { label: "type=voice", body: { number: PHONE_FAKE, type: "voice", file: FAKE_FILE } },
  { label: "type=audio (default)", body: { number: PHONE_FAKE, type: "audio", file: FAKE_FILE } },
  { label: "media body", body: { number: PHONE_FAKE, mediatype: "ptt", media: FAKE_FILE } },
  { label: "audioMessage:true ptt:true", body: { number: PHONE_FAKE, audioMessage: true, ptt: true, file: FAKE_FILE, type: "audio" } },
];

async function main() {
  for (const v of VARIANTS) {
    try {
      const r = await fetch(`${BASE}/send/media`, {
        method: "POST",
        headers: { token: TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(v.body),
      });
      const t = await r.text();
      console.log(`\n${v.label}: ${r.status}`);
      console.log(`  body: ${JSON.stringify(v.body).replace(FAKE_FILE, "<file>").slice(0, 200)}`);
      console.log(`  resp: ${t.slice(0, 200)}`);
    } catch (e) {
      console.log(`${v.label}: err ${e instanceof Error ? e.message : e}`);
    }
  }

  // Também tenta endpoints alternativos
  console.log("\n=== Endpoints alternativos ===");
  const alt = [
    "/send/audio",
    "/send/ptt",
    "/send/voice",
    "/message/send/media",
    "/message/sendAudio",
  ];
  for (const path of alt) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { token: TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ number: PHONE_FAKE, file: FAKE_FILE, type: "ptt" }),
      });
      console.log(`POST ${path}: ${r.status} ${(await r.text()).slice(0, 150)}`);
    } catch (e) {
      console.log(`${path}: err ${e instanceof Error ? e.message : e}`);
    }
  }
}
main().catch(console.error);
