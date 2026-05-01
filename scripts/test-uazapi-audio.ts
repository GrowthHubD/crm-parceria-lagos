/**
 * Testa diferentes endpoints e formatos de body pra envio de ÁUDIO na Uazapi v2.
 * Usa número FAKE (5500000000000) pra evitar entregar pra contatos reais.
 *
 * Discovery — tenta:
 *   - /send/audio
 *   - /send/media
 *   - /send/voice
 *   - /send/ptt
 * Com bodies variando entre `audio`, `file`, `base64`, `media`, mais `number` vs `phone`,
 * e com/sem `type`.
 *
 * Roda com:  npx tsx scripts/test-uazapi-audio.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

const BASE = "https://williphone.uazapi.com";
const TOKEN = "e88c26aa-583f-4402-a2e9-7e612613af53";
const PHONE = "5500000000000"; // FAKE pra discovery

// Mini OGG/Opus base64 (~1KB silêncio gerado offline) — content irrelevante, só pra API aceitar
// Aqui usamos um tiny WAV header como placeholder; a API valida formato no nível dela.
// Usaremos um mp3 base64 válido mínimo.
const TINY_AUDIO_B64 =
  "T2dnUwACAAAAAAAAAAA+HAAAAAAAAGRAJN0BHgF2b3JiaXMAAAAAAUSsAAAAAAAAgLsAAAAAAAC4AU9nZ1MAAAAAAAAAAAAAPhwAAAEAAACdjAakDQ==";

const DATA_URI = `data:audio/ogg;base64,${TINY_AUDIO_B64}`;
const RAW_B64 = TINY_AUDIO_B64;

interface Trial {
  label: string;
  path: string;
  body: Record<string, unknown>;
}

const trials: Trial[] = [
  // /send/audio
  { label: "audio  number+audio(dataUri) ptt=true", path: "/send/audio", body: { number: PHONE, audio: DATA_URI, ptt: true } },
  { label: "audio  number+audio(rawB64) ptt=true", path: "/send/audio", body: { number: PHONE, audio: RAW_B64, ptt: true } },
  { label: "audio  number+file(dataUri)", path: "/send/audio", body: { number: PHONE, file: DATA_URI } },
  { label: "audio  number+base64", path: "/send/audio", body: { number: PHONE, base64: RAW_B64 } },
  { label: "audio  phone+audio(dataUri)", path: "/send/audio", body: { phone: PHONE, audio: DATA_URI, ptt: true } },

  // /send/media
  { label: "media  number+file(dataUri) type=audio", path: "/send/media", body: { number: PHONE, file: DATA_URI, type: "audio" } },
  { label: "media  number+media(dataUri) type=ptt", path: "/send/media", body: { number: PHONE, media: DATA_URI, type: "ptt" } },
  { label: "media  number+file(dataUri) type=ptt", path: "/send/media", body: { number: PHONE, file: DATA_URI, type: "ptt" } },
  { label: "media  number+audio(dataUri)", path: "/send/media", body: { number: PHONE, audio: DATA_URI } },

  // /send/voice
  { label: "voice  number+audio(dataUri)", path: "/send/voice", body: { number: PHONE, audio: DATA_URI } },
  { label: "voice  number+file(dataUri)", path: "/send/voice", body: { number: PHONE, file: DATA_URI } },

  // /send/ptt
  { label: "ptt    number+audio(dataUri)", path: "/send/ptt", body: { number: PHONE, audio: DATA_URI } },
  { label: "ptt    number+file(dataUri)", path: "/send/ptt", body: { number: PHONE, file: DATA_URI } },
];

async function tryTrial(t: Trial) {
  try {
    const r = await fetch(`${BASE}${t.path}`, {
      method: "POST",
      headers: { token: TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(t.body),
    });
    const text = await r.text();
    const trimmed = text.replace(/\s+/g, " ").slice(0, 240);
    console.log(`[${r.status}] ${t.label}\n      ${trimmed}\n`);
  } catch (e) {
    console.log(`[ERR] ${t.label}: ${e instanceof Error ? e.message : e}\n`);
  }
}

async function main() {
  console.log(`→ Discovery Uazapi audio endpoints (BASE=${BASE})\n`);
  for (const t of trials) {
    await tryTrial(t);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
