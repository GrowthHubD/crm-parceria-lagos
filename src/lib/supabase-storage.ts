/**
 * Supabase Storage helper — upload de mídia WhatsApp.
 *
 * Bucket: `whatsapp-media` (público, file-size limit 50MB)
 * Path: `{tenantId}/{conversationId}/{uuid}.{ext}`
 *
 * Diferente de `src/lib/storage.ts` que serve o R2 (usado pra contratos).
 */

import { getSupabaseAdmin } from "./supabase/admin";

const BUCKET = "whatsapp-media";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/webm": "weba",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/zip": "zip",
  "application/octet-stream": "bin",
};

export function extFromMime(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? "bin";
}

export interface UploadResult {
  path: string;
  publicUrl: string;
}

/**
 * Sobe um data URI / Buffer pro bucket. Retorna a URL pública.
 */
export async function uploadWhatsappMedia(params: {
  tenantId: string;
  conversationId: string;
  data: string | Buffer | Uint8Array; // data URI completo ou Buffer
  mimetype?: string; // necessário se `data` for Buffer
  filename?: string;
}): Promise<UploadResult | null> {
  let buffer: Buffer;
  let mime = params.mimetype ?? "application/octet-stream";

  if (typeof params.data === "string") {
    // Regex tolerante: o mimetype pode ter parâmetros (ex: "audio/ogg; codecs=opus")
    // Captura o mime inteiro até `;base64,` (sem inclusive ; base64)
    const match = params.data.match(/^data:(.+?);base64,(.+)$/);
    if (match) {
      // Remove parâmetros do mime (fica só "audio/ogg") pra compatibilidade com allowlist do Supabase
      mime = match[1].split(";")[0].trim();
      buffer = Buffer.from(match[2], "base64");
    } else {
      buffer = Buffer.from(params.data, "base64");
    }
  } else if (Buffer.isBuffer(params.data)) {
    buffer = params.data;
  } else {
    buffer = Buffer.from(params.data);
  }

  if (buffer.length === 0) return null;

  const ext = extFromMime(mime);
  const uuid = crypto.randomUUID();
  const path = `${params.tenantId}/${params.conversationId}/${uuid}.${ext}`;

  try {
    const supa = getSupabaseAdmin();
    const { error } = await supa.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: mime,
        upsert: false,
      });

    if (error) {
      console.error("[STORAGE] upload failed:", error.message, "size=", buffer.length, "mime=", mime);
      return null;
    }

    const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(path);
    return { path, publicUrl: urlData.publicUrl };
  } catch (e) {
    console.error("[STORAGE] upload exception:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function deleteWhatsappMedia(path: string): Promise<boolean> {
  try {
    const supa = getSupabaseAdmin();
    const { error } = await supa.storage.from(BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}

export function pathFromPublicUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/whatsapp-media\/(.+)$/);
  return m?.[1] ?? null;
}
