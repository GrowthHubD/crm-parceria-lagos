/**
 * Conversão de áudio webm/opus → ogg/opus pra mensagens de voz no WhatsApp.
 *
 * MediaRecorder do Chrome/Edge grava em `audio/webm; codecs=opus`. Mas WhatsApp
 * (via Baileys/Uazapi) só renderiza balão de voz (PTT) quando o mimetype é
 * `audio/ogg; codecs=opus` E o container é OGG. O codec opus é o MESMO entre
 * os dois — só muda o container — então usamos `-c:a copy` (repackage) ao
 * invés de re-encode. Rápido (~50ms) e sem perda de qualidade.
 *
 * Refs:
 *   - Baileys issue #1828, #1745 (mimetype EXATO 'audio/ogg; codecs=opus')
 *   - whatsapp-web.js PR #1956 (parâmetros 32k/48kHz/mono pra fallback re-encode)
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// @ffmpeg-installer/ffmpeg fornece o binário multiplataforma. Path resolvido
// no boot — em prod (Cloudflare Workers) isso não funciona; em dev/Node sim.
let ffmpegPath: string | null = null;
try {
  // Lazy require pra não falhar na build do edge runtime
  const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
  ffmpegPath = ffmpegInstaller.path;
} catch {
  // sem ffmpeg-installer → fallback pra ffmpeg do PATH (se estiver instalado)
  ffmpegPath = "ffmpeg";
}

/**
 * Converte buffer webm/opus → ogg/opus mantendo codec (sem re-encode).
 * Retorna o Buffer ogg pronto pra envio.
 *
 * Throws se o ffmpeg falhar.
 */
export async function webmOpusToOggOpus(input: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `audio-in-${id}.webm`);
  const outputPath = join(tmpdir(), `audio-out-${id}.ogg`);

  try {
    await fs.writeFile(inputPath, input);

    await new Promise<void>((resolve, reject) => {
      // Re-encode com parâmetros que WhatsApp/Baileys exigem pra renderizar
      // como balão de voz (PTT). `-c:a copy` (só repackage) NÃO funciona —
      // produz ogg válido mas WhatsApp cai pra documento. Re-encode é
      // necessário com:
      //   libopus codec
      //   32 kbps bitrate (padrão Telegram/WhatsApp)
      //   48 kHz sample rate
      //   1 canal (mono)
      // Ref: pedroslopez/whatsapp-web.js PR #1956, ultramsg blog
      const args = [
        "-y",
        "-i", inputPath,
        "-c:a", "libopus",
        "-b:a", "32k",
        "-ar", "48000",
        "-ac", "1",
        "-application", "voip", // otimiza pra voz (vs music)
        "-map_metadata", "-1",
        "-f", "ogg",
        outputPath,
      ];
      const proc = spawn(ffmpegPath || "ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += String(d); });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
      });
    });

    const out = await fs.readFile(outputPath);
    return out;
  } finally {
    // Cleanup temp files (best-effort)
    fs.unlink(inputPath).catch(() => {});
    fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Recebe data URI (`data:audio/webm;base64,...`), converte pra ogg e retorna
 * um data URI novo (`data:audio/ogg;codecs=opus;base64,...`). Se a entrada
 * já for ogg, retorna sem mexer. Se a conversão falhar, volta o original
 * (caller pode usar como fallback — vai como documento mas pelo menos não
 * quebra o envio).
 */
export async function ensureOggDataUri(dataUri: string): Promise<string> {
  const match = dataUri.match(/^data:([^;]+)(;[^,]+)?,(.+)$/);
  if (!match) return dataUri;
  const mime = match[1].toLowerCase();
  const base64 = match[3];

  if (mime.includes("ogg")) return dataUri; // já é ogg
  if (!mime.includes("webm") && !mime.includes("audio")) return dataUri;

  try {
    const inputBuffer = Buffer.from(base64, "base64");
    const t0 = Date.now();
    const oggBuffer = await webmOpusToOggOpus(inputBuffer);
    const ms = Date.now() - t0;
    const oggB64 = oggBuffer.toString("base64");
    console.log(`[audio-convert] webm→ogg OK (${inputBuffer.length}B → ${oggBuffer.length}B, ${ms}ms)`);
    return `data:audio/ogg;codecs=opus;base64,${oggB64}`;
  } catch (e) {
    console.warn("[audio-convert] webm→ogg falhou, devolvendo original:", e instanceof Error ? e.message : e);
    return dataUri;
  }
}
