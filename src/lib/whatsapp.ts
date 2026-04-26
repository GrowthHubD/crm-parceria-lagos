/**
 * WhatsApp provider facade.
 *
 * Switch automático baseado em NODE_ENV:
 * - development → Evolution API (instância compartilhada dev)
 * - production  → Uazapi v2 (instâncias dedicadas por cliente)
 *
 * Toda rota que envia/conecta WhatsApp deve usar esta facade em vez
 * de chamar `evolution.ts` ou `uazapi.ts` diretamente.
 */

import {
  evolutionCreateInstance,
  evolutionConnect,
  evolutionGetState,
  evolutionSetWebhook,
  evolutionDeleteInstance,
  evolutionSendText,
  evolutionSendMedia,
  instanceNameFromSlug,
} from "./evolution";
import {
  uazapiInitInstance,
  uazapiGetQr,
  uazapiGetStatus,
  uazapiLogout,
  uazapiSetWebhook,
  uazapiSendText,
  uazapiSendMedia,
  uazapiInstanceIdFromSlug,
} from "./uazapi";

export type WhatsappProvider = "evolution" | "uazapi";

// Override explícito via env (`WHATSAPP_PROVIDER=uazapi|evolution`) tem prioridade
// sobre o switch automático por NODE_ENV. Útil pra testar Uazapi em dev local
// sem mudar NODE_ENV (que afetaria outras coisas do framework).
export const WHATSAPP_PROVIDER: WhatsappProvider = (() => {
  const override = process.env.WHATSAPP_PROVIDER?.toLowerCase();
  if (override === "uazapi" || override === "evolution") return override;
  return process.env.NODE_ENV === "production" ? "uazapi" : "evolution";
})();

// ── Types ──────────────────────────────────────────────────────────────

export type InstanceState = "open" | "connecting" | "close";

export interface CreateResult {
  ok: boolean;
  /** Token específico da instância (Uazapi devolve; Evolution não usa) */
  token?: string;
}

export interface QrResult {
  qrCode: string | null;
  connected: boolean;
}

export interface StatusResult {
  state: InstanceState;
  phoneNumber?: string;
}

export interface SendResult {
  messageId?: string;
  error?: string;
}

// ── Instance management ────────────────────────────────────────────────

export async function createInstance(
  instanceId: string,
  webhookUrl: string
): Promise<CreateResult> {
  if (WHATSAPP_PROVIDER === "uazapi") {
    try {
      const r = await uazapiInitInstance(instanceId);
      const token = r.token;
      await uazapiSetWebhook(webhookUrl, token);
      return { ok: true, token };
    } catch {
      return { ok: false };
    }
  }

  try {
    const r = await evolutionCreateInstance(instanceId, webhookUrl);
    return { ok: !r.error };
  } catch {
    // Pode já existir — configurar webhook e seguir
    try {
      await evolutionSetWebhook(instanceId, webhookUrl);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}

export async function getQrCode(
  instanceId: string,
  token?: string
): Promise<QrResult> {
  if (WHATSAPP_PROVIDER === "uazapi") {
    const r = await uazapiGetQr(instanceId, token);
    if (r.connected) return { qrCode: null, connected: true };
    return { qrCode: r.qrcode ?? null, connected: false };
  }

  const r = await evolutionConnect(instanceId);
  return { qrCode: r.base64 ?? r.code ?? null, connected: false };
}

export async function getStatus(
  instanceId: string,
  token?: string
): Promise<StatusResult> {
  if (WHATSAPP_PROVIDER === "uazapi") {
    const r = await uazapiGetStatus(instanceId, token);
    const connected = r.connected === true || r.status === "connected";
    const state: InstanceState = connected
      ? "open"
      : r.status === "connecting"
      ? "connecting"
      : "close";
    return { state, phoneNumber: r.phone };
  }

  const r = await evolutionGetState(instanceId);
  return {
    state: (r.instance?.state as InstanceState) ?? "close",
    phoneNumber: undefined,
  };
}

export async function setWebhook(
  instanceId: string,
  webhookUrl: string,
  token?: string
): Promise<boolean> {
  if (WHATSAPP_PROVIDER === "uazapi") {
    return uazapiSetWebhook(webhookUrl, token);
  }
  try {
    await evolutionSetWebhook(instanceId, webhookUrl);
    return true;
  } catch {
    return false;
  }
}

export async function deleteInstance(
  instanceId: string,
  token?: string
): Promise<void> {
  if (WHATSAPP_PROVIDER === "uazapi") {
    await uazapiLogout(instanceId, token);
    return;
  }
  try {
    await evolutionDeleteInstance(instanceId);
  } catch {
    // best-effort
  }
}

// ── Messaging ─────────────────────────────────────────────────────────

export async function sendText(
  instanceId: string,
  token: string | undefined,
  phone: string,
  text: string,
  quoted?: {
    key: { id: string; remoteJid: string; fromMe: boolean };
    message: { conversation: string };
  }
): Promise<SendResult> {
  if (WHATSAPP_PROVIDER === "uazapi") {
    // Uazapi v2 não suporta quoted via API pública (ainda) — envia sem
    try {
      const r = await uazapiSendText(instanceId, token, phone, text);
      return { messageId: r.message_id, error: r.error };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  try {
    const r = await evolutionSendText(instanceId, phone, text, quoted);
    return { messageId: r.key?.id, error: r.error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendMedia(
  instanceId: string,
  token: string | undefined,
  phone: string,
  dataUri: string,
  fileName?: string,
  caption?: string
): Promise<SendResult> {
  if (WHATSAPP_PROVIDER === "uazapi") {
    try {
      const r = await uazapiSendMedia(
        instanceId,
        token,
        phone,
        dataUri,
        fileName,
        caption
      );
      return { messageId: r.message_id, error: r.error };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  try {
    const r = await evolutionSendMedia(instanceId, phone, dataUri, fileName, caption);
    return { messageId: r.key?.id, error: r.error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Deriva um identifier estável a partir do slug do tenant.
 * Mesmo formato em ambos providers.
 */
export function instanceIdFromSlug(slug: string): string {
  return WHATSAPP_PROVIDER === "uazapi"
    ? uazapiInstanceIdFromSlug(slug)
    : instanceNameFromSlug(slug);
}
