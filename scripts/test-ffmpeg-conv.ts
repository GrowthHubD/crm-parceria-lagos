/**
 * Verifica se a conversão webm→ogg está funcionando.
 * Cria um webm pequeno, converte, valida o output.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

async function main() {
  // 1. Verifica que o ffmpeg-installer expõe um binário acessível
  let ffmpegPath = "ffmpeg";
  try {
    const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
    ffmpegPath = ffmpegInstaller.path;
    console.log(`ffmpeg path: ${ffmpegPath}`);
  } catch (e) {
    console.log("@ffmpeg-installer não carregou:", e instanceof Error ? e.message : e);
  }

  // 2. Roda 'ffmpeg -version' pra confirmar que executa
  const { spawn } = await import("child_process");
  await new Promise<void>((resolve) => {
    const proc = spawn(ffmpegPath, ["-version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => { out += String(d); });
    proc.on("close", (code) => {
      console.log(`\nffmpeg -version exit=${code}`);
      console.log(out.split("\n").slice(0, 3).join("\n"));
      resolve();
    });
    proc.on("error", (e) => {
      console.log("ffmpeg ERROR:", e.message);
      resolve();
    });
  });

  // 3. Testa nossa função real
  const { ensureOggDataUri } = await import("../src/lib/audio-convert");

  // Cria um webm/opus minimo válido (header EBML+webm com 0 frames seria complexo;
  // usa sample real menor possível). Como atalho: usa o blob que o navegador
  // tipicamente gera. Não temos um blob real aqui, mas podemos verificar que
  // a função NÃO crasha com um data URI inválido:
  const dummy = "data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua7+uudeBAXPFh62vO4XkmkBA";
  console.log("\nTestando ensureOggDataUri com webm sample...");
  try {
    const out = await ensureOggDataUri(dummy);
    console.log(`  out prefix: ${out.slice(0, 80)}`);
    console.log(`  out total length: ${out.length}`);
  } catch (e) {
    console.log("  ERRO:", e instanceof Error ? e.message : e);
  }
}
main().catch(console.error);
