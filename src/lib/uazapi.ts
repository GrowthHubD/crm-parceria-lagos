/**
 * Uazapi v2 API client
 * Docs: https://docs.uazapi.com
 *
 * Autenticação: header `token: <TOKEN>` (NÃO usa Authorization Bearer).
 * Instâncias identificadas por `instance_id` em body/query.
 */

import { db } from "./db";
import { whatsappNumber, crmConversation } from "./db/schema/crm";
import { eq, and } from "drizzle-orm";

const BASE = (process.env.UAZAPI_BASE_URL ?? "https://api.uazapi.com").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN ?? process.env.UAZAPI_TOKEN ?? "";

function authHeaders(token?: string) {
  const t = token || ADMIN_TOKEN;
  return {
    "Content-Type": "application/json",
    token: t,
  };
}

async function req<T>(
  path: string,
  init?: RequestInit,
  token?: string
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Uazapi API ${path}: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ── Types ──────────────────────────────────────────────────────────────

export type UazapiStatusValue = "connected" | "disconnected" | "connecting" | "qr";

export interface UazapiInitResult {
  status?: string;
  message?: string;
  session?: string;
  token?: string;
  instance_id?: string;
}

export interface UazapiQrResult {
  status?: string;
  qrcode?: string;
  connected?: boolean;
}

export interface UazapiStatusResult {
  status: UazapiStatusValue | string;
  phone?: string;
  name?: string;
  connected?: boolean;
}

export interface UazapiSendResult {
  status?: string;
  message_id?: string;
  error?: string;
}

// ── Instance management ────────────────────────────────────────────────

/**
 * Cria/reinicia uma instância. Retorna token específico da instância
 * se a API fornecer; senão cai no admin token global.
 */
export async function uazapiInitInstance(instanceId: string): Promise<UazapiInitResult> {
  return req<UazapiInitResult>("/instance/init", {
    method: "POST",
    body: JSON.stringify({ instance_id: instanceId }),
  });
}

export async function uazapiGetQr(
  instanceId: string,
  instanceToken?: string
): Promise<UazapiQrResult> {
  try {
    return await req<UazapiQrResult>(
      `/instance/qrcode?instance_id=${encodeURIComponent(instanceId)}`,
      undefined,
      instanceToken
    );
  } catch {
    return { status: "error", connected: false };
  }
}

export async function uazapiGetStatus(
  instanceId: string,
  instanceToken?: string
): Promise<UazapiStatusResult> {
  try {
    const r = await req<UazapiStatusResult>(
      `/instance/status?instance_id=${encodeURIComponent(instanceId)}`,
      undefined,
      instanceToken
    );
    return r;
  } catch {
    return { status: "disconnected", connected: false };
  }
}

export async function uazapiLogout(
  instanceId: string,
  instanceToken?: string
): Promise<void> {
  try {
    await req(
      "/instance/logout",
      {
        method: "POST",
        body: JSON.stringify({ instance_id: instanceId }),
      },
      instanceToken
    );
  } catch {
    // best-effort
  }
}

export async function uazapiSetWebhook(
  webhookUrl: string,
  instanceToken?: string
): Promise<boolean> {
  try {
    await req(
      "/webhook/set",
      {
        method: "POST",
        body: JSON.stringify({ webhook_url: webhookUrl }),
      },
      instanceToken
    );
    return true;
  } catch {
    return false;
  }
}

// ── Messaging ─────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export async function uazapiSendText(
  _instanceId: string,
  instanceToken: string | undefined,
  phone: string,
  message: string
): Promise<UazapiSendResult> {
  // Uazapi v2 espera `{ number, text }` no body. A instância é identificada
  // pelo header `token:` (instanceToken), não pelo body.
  return req<UazapiSendResult>(
    "/send/text",
    {
      method: "POST",
      body: JSON.stringify({
        number: normalizePhone(phone),
        text: message,
      }),
    },
    instanceToken
  );
}

// Uazapi v2 — TODA mídia (image/video/audio/document) vai via /send/media
// com `{ number, file (data URI), type, ... }`. A instância é identificada
// SOMENTE pelo header `token:` — body NÃO leva instance_id.
// Discovery: scripts/test-uazapi-audio.ts ([405] em /send/audio /send/voice /send/ptt;
// [500 "not on WhatsApp"] em /send/media confirma o schema aceito).

export async function uazapiSendImage(
  _instanceId: string,
  instanceToken: string | undefined,
  phone: string,
  image: string,
  caption?: string
): Promise<UazapiSendResult> {
  return req<UazapiSendResult>(
    "/send/media",
    {
      method: "POST",
      body: JSON.stringify({
        number: normalizePhone(phone),
        type: "image",
        file: image,
        ...(caption ? { text: caption } : {}),
      }),
    },
    instanceToken
  );
}

export async function uazapiSendVideo(
  _instanceId: string,
  instanceToken: string | undefined,
  phone: string,
  video: string,
  caption?: string
): Promise<UazapiSendResult> {
  return req<UazapiSendResult>(
    "/send/media",
    {
      method: "POST",
      body: JSON.stringify({
        number: normalizePhone(phone),
        type: "video",
        file: video,
        ...(caption ? { text: caption } : {}),
      }),
    },
    instanceToken
  );
}

/**
 * Áudio. Por padrão `ptt=true` → vai como **mensagem de voz** (push-to-talk),
 * que é o formato esperado pra áudios gravados na UI do CRM.
 * Se `ptt=false`, vai como áudio "de música" (anexo).
 */
export async function uazapiSendAudio(
  _instanceId: string,
  instanceToken: string | undefined,
  phone: string,
  audio: string,
  ptt = true
): Promise<UazapiSendResult> {
  return req<UazapiSendResult>(
    "/send/media",
    {
      method: "POST",
      body: JSON.stringify({
        number: normalizePhone(phone),
        type: ptt ? "ptt" : "audio",
        file: audio,
      }),
    },
    instanceToken
  );
}

export async function uazapiSendDocument(
  _instanceId: string,
  instanceToken: string | undefined,
  phone: string,
  document: string,
  filename?: string
): Promise<UazapiSendResult> {
  return req<UazapiSendResult>(
    "/send/media",
    {
      method: "POST",
      body: JSON.stringify({
        number: normalizePhone(phone),
        type: "document",
        file: document,
        ...(filename ? { docName: filename } : {}),
      }),
    },
    instanceToken
  );
}

/**
 * Detecta o tipo de mídia pelo data URI / extensão e chama o endpoint correto.
 */
export async function uazapiSendMedia(
  instanceId: string,
  instanceToken: string | undefined,
  phone: string,
  dataUriOrUrl: string,
  fileName?: string,
  caption?: string
): Promise<UazapiSendResult> {
  const dataMatch = dataUriOrUrl.match(/^data:([^;]+);base64,/);
  const mime = dataMatch?.[1] ?? "";

  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(dataUriOrUrl)) {
    return uazapiSendImage(instanceId, instanceToken, phone, dataUriOrUrl, caption);
  }
  if (mime.startsWith("video/") || /\.(mp4|mov|avi|mkv)$/i.test(dataUriOrUrl)) {
    return uazapiSendVideo(instanceId, instanceToken, phone, dataUriOrUrl, caption);
  }
  if (mime.startsWith("audio/") || /\.(mp3|ogg|opus|m4a|wav)$/i.test(dataUriOrUrl)) {
    return uazapiSendAudio(instanceId, instanceToken, phone, dataUriOrUrl);
  }
  return uazapiSendDocument(instanceId, instanceToken, phone, dataUriOrUrl, fileName);
}

// ── Helpers de domínio ────────────────────────────────────────────────

/**
 * Deriva um instance_id estável a partir do slug do tenant.
 * Mesmo formato usado pelo Evolution provider.
 */
export function uazapiInstanceIdFromSlug(slug: string): string {
  return `crm-${slug}`
    .replace(/[^a-z0-9-]/g, "-")
    .toLowerCase()
    .slice(0, 40);
}

/**
 * Retorna (instanceId, token) do whatsappNumber ativo do tenant.
 */
export async function getUazapiCredsForTenant(
  tenantId: string
): Promise<{ instanceId: string; token: string | undefined } | null> {
  const [wNum] = await db
    .select({
      uazapiSession: whatsappNumber.uazapiSession,
      uazapiToken: whatsappNumber.uazapiToken,
    })
    .from(whatsappNumber)
    .where(
      and(
        eq(whatsappNumber.tenantId, tenantId),
        eq(whatsappNumber.isActive, true)
      )
    )
    .limit(1);

  if (!wNum?.uazapiSession) return null;
  return { instanceId: wNum.uazapiSession, token: wNum.uazapiToken || undefined };
}

/**
 * Retorna (instanceId, token, contactPhone, conversationId) por conversationId.
 */
export async function getUazapiCredsForConversation(conversationId: string) {
  const [row] = await db
    .select({
      conversationId: crmConversation.id,
      contactPhone: crmConversation.contactPhone,
      tenantId: crmConversation.tenantId,
      instanceId: whatsappNumber.uazapiSession,
      token: whatsappNumber.uazapiToken,
    })
    .from(crmConversation)
    .innerJoin(
      whatsappNumber,
      eq(crmConversation.whatsappNumberId, whatsappNumber.id)
    )
    .where(eq(crmConversation.id, conversationId))
    .limit(1);

  if (!row?.instanceId) return null;
  return {
    instanceId: row.instanceId,
    token: row.token || undefined,
    contactPhone: row.contactPhone,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
  };
}

// ── Webhook payload helpers ──────────────────────────────────────────
// Uazapi v2 envia payloads simples `{ event, instance, data: { from, body, type, ... } }`
// Os webhooks legados (Baileys-wrapped) são tratados com extractPhone/extractContent.

export function extractPhone(jidOrPhone: string): string {
  return jidOrPhone.replace(/@.*$/, "").replace(/[^0-9]/g, "");
}

export interface ExtractedContent {
  content: string | null;
  mediaType: string;
}

/**
 * Extrai content+mediaType do payload v2 flat:
 * `{ data: { body, type: "text"|"image"|... } }`
 */
export function extractContentV2(payload: Record<string, unknown>): ExtractedContent {
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data) return { content: null, mediaType: "text" };
  const body = typeof data.body === "string" ? data.body : null;
  const type = typeof data.type === "string" ? data.type : "text";
  return { content: body, mediaType: type };
}

/**
 * Extrai content+mediaType do payload Baileys-wrapped (Evolution + Uazapi legacy):
 * `{ data: { message: { conversation | imageMessage | ... } } }`
 */
export function extractContent(payload: Record<string, unknown>): ExtractedContent {
  const data = payload.data as Record<string, unknown> | undefined;
  const msg = data?.message as Record<string, unknown> | undefined;

  if (!msg) return { content: null, mediaType: "text" };

  if (typeof msg.conversation === "string") {
    return { content: msg.conversation, mediaType: "text" };
  }

  const ext = msg.extendedTextMessage as Record<string, unknown> | undefined;
  if (ext?.text && typeof ext.text === "string") {
    return { content: ext.text, mediaType: "text" };
  }

  const imageMsg = msg.imageMessage as Record<string, unknown> | undefined;
  if (imageMsg) {
    return {
      content: (imageMsg.caption as string) ?? null,
      mediaType: "image",
    };
  }

  const videoMsg = msg.videoMessage as Record<string, unknown> | undefined;
  if (videoMsg) {
    return {
      content: (videoMsg.caption as string) ?? null,
      mediaType: "video",
    };
  }

  if (msg.audioMessage) return { content: null, mediaType: "audio" };

  const docMsg = msg.documentMessage as Record<string, unknown> | undefined;
  if (docMsg) {
    return {
      content: (docMsg.fileName as string) ?? null,
      mediaType: "document",
    };
  }

  return { content: null, mediaType: "text" };
}
