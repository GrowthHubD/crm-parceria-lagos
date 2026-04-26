/**
 * Evolution API v2 client
 * Docs: https://doc.evolution-api.com/v2
 */

const BASE = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
const KEY = process.env.EVOLUTION_API_KEY ?? "";

function h() {
  return { "Content-Type": "application/json", apikey: KEY };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...h(), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Evolution API: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
}

// ── Types ──────────────────────────────────────────────────────────────

export type EvolutionState = "open" | "connecting" | "close";

export interface EvolutionCreateResult {
  instance?: { instanceName: string; status: string };
  qrcode?: { code: string; base64?: string };
  error?: string;
}

export interface EvolutionConnectResult {
  code?: string;
  base64?: string;
  error?: string;
}

export interface EvolutionStateResult {
  instance?: { instanceName: string; state: EvolutionState };
  error?: string;
}

export interface EvolutionSendResult {
  key?: { id: string };
  error?: string;
}

// ── Types (cont.) ─────────────────────────────────────────────────────

export interface EvolutionInstanceInfo {
  name: string;
  connectionStatus: string;
  ownerJid?: string;
  number?: string;
}

// ── Instance management ────────────────────────────────────────────────

export async function evolutionFetchInstances(): Promise<EvolutionInstanceInfo[]> {
  try {
    const data = await req<EvolutionInstanceInfo[]>("/instance/fetchInstances");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function evolutionCreateInstance(
  instanceName: string,
  webhookUrl: string
): Promise<EvolutionCreateResult> {
  return req<EvolutionCreateResult>("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: true,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    }),
  });
}

/** Connect (or reconnect) to an instance — returns QR code */
export async function evolutionConnect(instanceName: string): Promise<EvolutionConnectResult> {
  return req<EvolutionConnectResult>(`/instance/connect/${instanceName}`);
}

export async function evolutionGetState(instanceName: string): Promise<EvolutionStateResult> {
  return req<EvolutionStateResult>(`/instance/connectionState/${instanceName}`);
}

export async function evolutionDeleteInstance(instanceName: string): Promise<void> {
  await req(`/instance/delete/${instanceName}`, { method: "DELETE" });
}

export async function evolutionSetWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  await req(`/webhook/set/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: true,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    }),
  });
}

// ── Messaging ─────────────────────────────────────────────────────────

export async function evolutionSendText(
  instanceName: string,
  phone: string,
  text: string,
  quoted?: { key: { id: string; remoteJid: string; fromMe: boolean }; message: { conversation: string } }
): Promise<EvolutionSendResult> {
  const number = phone.includes("@") ? phone : phone.replace(/\D/g, "");
  return req<EvolutionSendResult>(`/message/sendText/${instanceName}`, {
    method: "POST",
    body: JSON.stringify(quoted ? { number, text, quoted } : { number, text }),
  });
}

export async function evolutionSendMedia(
  instanceName: string,
  phone: string,
  dataUri: string,
  fileName?: string,
  caption?: string
): Promise<EvolutionSendResult> {
  const number = phone.includes("@") ? phone : phone.replace(/\D/g, "");
  const match = dataUri.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("Invalid data URI");
  const [, mimetype, media] = match;
  const isImage = mimetype.startsWith("image/");
  const mediatype = isImage ? "image" : "document";
  const body: Record<string, unknown> = { number, mediatype, media, mimetype };
  if (!isImage && fileName) body.fileName = fileName;
  if (caption) body.caption = caption;
  return req<EvolutionSendResult>(`/message/sendMedia/${instanceName}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** @deprecated use evolutionSendMedia */
export const evolutionSendImage = evolutionSendMedia;

export async function evolutionFetchProfilePicture(
  instanceName: string,
  phone: string
): Promise<string | null> {
  try {
    const number = phone.includes("@") ? phone.replace(/@.*$/, "") : phone.replace(/\D/g, "");
    const data = await req<Record<string, unknown>>(
      `/chat/fetchProfilePictureUrl/${instanceName}`,
      { method: "POST", body: JSON.stringify({ number }) }
    );
    const url = data.profilePictureUrl ?? data.url ?? data.picture ?? data.imageUrl ?? data.imgUrl;
    return typeof url === "string" && url.startsWith("http") ? url : null;
  } catch {
    return null;
  }
}

export interface EvolutionMediaResult {
  base64?: string;
  mimetype?: string;
  error?: string;
}

export async function evolutionGetMediaBase64(
  instanceName: string,
  // Pass the full message object from the webhook — Evolution needs mediaKey to decrypt
  message: Record<string, unknown>
): Promise<EvolutionMediaResult> {
  try {
    return await req<EvolutionMediaResult>(`/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({ message, convertToMp4: false }),
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.warn(`[EVOLUTION] getBase64FromMediaMessage failed (instance=${instanceName}):`, err.slice(0, 200));
    return { error: err };
  }
}

export async function evolutionFetchGroupMetadata(
  instanceName: string,
  groupJid: string
): Promise<{ subject?: string } | null> {
  try {
    return await req<{ subject?: string }>(`/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`);
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Derives a stable Evolution instance name from a tenant slug */
export function instanceNameFromSlug(slug: string): string {
  return `crm-${slug}`.replace(/[^a-z0-9-]/g, "-").toLowerCase().slice(0, 40);
}
