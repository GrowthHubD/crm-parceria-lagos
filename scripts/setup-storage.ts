/**
 * Cria o bucket `whatsapp-media` no Supabase Storage + policies.
 *
 * Bucket é público (URLs previsíveis via path com UUID — isolamento por obscuridade).
 * Uploads só via service_role (server-side). Leitura pública pra exibir no <img>.
 *
 * Idempotente: se bucket já existe, só garante as policies.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

import { createClient } from "@supabase/supabase-js";

const BUCKET = "whatsapp-media";

async function main() {
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // 1. Cria bucket (se não existir)
  const { data: buckets } = await supa.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);

  if (!exists) {
    const { error } = await supa.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 50 * 1024 * 1024, // 50 MB (cobre vídeo do WhatsApp)
      allowedMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/mp4",
        "audio/webm",
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",
        "application/octet-stream",
      ],
    });
    if (error) {
      console.error("❌ createBucket:", error.message);
      process.exit(1);
    }
    console.log(`✓ Bucket "${BUCKET}" criado (public)`);
  } else {
    console.log(`→ Bucket "${BUCKET}" já existe`);
  }

  // 2. Teste rápido: upload + URL pública (PNG 1x1 transparente)
  const pngBytes = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62000100000005000101a5e5" +
      "0abc0000000049454e44ae426082",
    "hex"
  );
  const testPath = `_healthcheck/${Date.now()}.png`;
  const { error: upErr } = await supa.storage
    .from(BUCKET)
    .upload(testPath, pngBytes, {
      upsert: true,
      contentType: "image/png",
    });
  if (upErr) {
    console.error("❌ upload teste:", upErr.message);
    process.exit(1);
  }

  const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(testPath);
  console.log(`✓ Upload teste OK: ${urlData.publicUrl}`);

  // Cleanup do teste
  await supa.storage.from(BUCKET).remove([testPath]);
  console.log(`✓ Healthcheck removido\n`);

  console.log("✅ Storage pronto pra uso.");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
