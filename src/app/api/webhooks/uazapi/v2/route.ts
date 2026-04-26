/**
 * Webhook Uazapi v2 — payload REAL (não o doc oficial flat antigo).
 *
 * Estrutura real (capturada via debug):
 * {
 *   BaseUrl, EventType, instanceName, owner, token,
 *   chat: {
 *     id, name, owner, phone, imagePreview,
 *     wa_chatid, wa_chatlid, wa_contactName, wa_isGroup,
 *     wa_lastMessageType, wa_lastMessageTextVote, wa_lastMsgTimestamp,
 *     wa_name, ...
 *   },
 *   chatSource: "updated" | ...,
 *   message: {
 *     id, messageid, chatid, chatlid,
 *     fromMe, isGroup, messageType, type, mediaType,
 *     messageTimestamp,  // ms epoch
 *     sender, senderName, source,
 *     text, content: { text, contextInfo },
 *     quoted, reaction, wasSentByApi,
 *     // mídia (campos OBSERVADOS na Uazapi v2 — cobertura ampla):
 *     mediaUrl, fileURL, fileurl, url, downloadUrl, file,
 *     mimetype, mediaMime, fileName,
 *     // base64 (caso webhook esteja configurado pra incluir):
 *     base64, mediaBase64, fileBase64
 *   }
 * }
 *
 * EventType conhecidos: "messages", "messages_update", "connection", "qr"
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crmConversation, crmMessage, whatsappNumber } from "@/lib/db/schema/crm";
import { lead, pipelineStage } from "@/lib/db/schema/pipeline";
import { eq, and, asc } from "drizzle-orm";
import { extractPhone } from "@/lib/uazapi";
import { triggerFirstMessage, processPendingAutomations } from "@/lib/automations/runner";
import { uploadWhatsappMedia } from "@/lib/supabase-storage";

interface UazapiV2Chat {
  id?: string;
  name?: string;
  owner?: string;
  phone?: string;
  imagePreview?: string;
  wa_chatid?: string;
  wa_chatlid?: string;
  wa_contactName?: string;
  wa_isGroup?: boolean;
  wa_name?: string;
}

interface UazapiV2Content {
  text?: string;
  caption?: string;
}

interface UazapiV2Message {
  id?: string;
  messageid?: string;
  chatid?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  messageType?: string;
  type?: string;
  mediaType?: string;
  messageTimestamp?: number; // ms
  sender?: string;
  senderName?: string;
  source?: string;
  text?: string;
  caption?: string;
  content?: UazapiV2Content;
  // Possíveis campos de mídia/URL — Uazapi v2 varia o nome conforme versão.
  mediaUrl?: string;
  fileURL?: string;
  fileurl?: string;
  url?: string;
  downloadUrl?: string;
  file?: string;
  mimetype?: string;
  mediaMime?: string;
  fileName?: string;
  filename?: string;
  // Base64 (quando webhook é configurado pra mandar binário inline)
  base64?: string;
  mediaBase64?: string;
  fileBase64?: string;
}

interface UazapiV2Payload {
  BaseUrl?: string;
  EventType?: string;
  instanceName?: string;
  owner?: string;
  token?: string;
  chat?: UazapiV2Chat;
  chatSource?: string;
  message?: UazapiV2Message;
}

/**
 * Detecta o tipo de mídia. Uazapi pode mandar:
 *   - mediaType: "image" | "video" | "audio" | "document" (canônico)
 *   - mediaType: "ptt" (push-to-talk) → tratamos como "audio"
 *   - type:      mesma coisa
 *   - messageType: "imageMessage" | "audioMessage" | ... (Baileys naming)
 */
function getMediaType(m: UazapiV2Message): string {
  const candidates = [m.mediaType, m.type, m.messageType]
    .map((s) => (s ?? "").toLowerCase())
    .filter(Boolean);

  for (const c of candidates) {
    // ptt e voice → áudio de mensagem de voz
    if (c === "ptt" || c === "voice" || c === "audio" || c.endsWith("audiomessage")) return "audio";
    if (c === "sticker" || c.endsWith("stickermessage")) return "sticker";
    if (c === "image" || c.endsWith("imagemessage")) return "image";
    if (c === "video" || c.endsWith("videomessage")) return "video";
    if (c === "document" || c.endsWith("documentmessage")) return "document";
    if (c === "text" || c === "conversation" || c === "extendedtext" || c === "extendedtextmessage") return "text";
  }
  return "text";
}

// Lista de chaves prováveis em Uazapi v2 que carregam a URL da mídia.
// Cobertura ampla porque diferentes versões/forks do Uazapi usam nomes
// distintos. Comparação case-insensitive feita via `pickFirstString`.
const URL_KEYS = [
  "mediaUrl",
  "media_url",
  "fileURL",
  "fileurl",
  "file_url",
  "url",
  "downloadUrl",
  "download_url",
  "directPath",
  "file",
];

const BASE64_KEYS = ["base64", "mediaBase64", "media_base64", "fileBase64", "file_base64"];

const MIME_KEYS = ["mimetype", "mediaMime", "media_mime", "mime", "contentType", "content_type"];

const FILENAME_KEYS = ["fileName", "filename", "file_name", "docName"];

/**
 * Pega o primeiro valor string não-vazio dentre as chaves dadas, em qualquer
 * casing. Útil porque a Uazapi v2 mistura camelCase/snake_case/lowercase.
 */
function pickFirstString(obj: Record<string, unknown>, keys: string[]): string | null {
  const lowerMap = new Map<string, unknown>();
  for (const k of Object.keys(obj)) lowerMap.set(k.toLowerCase(), obj[k]);
  for (const k of keys) {
    const v = lowerMap.get(k.toLowerCase());
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/**
 * Extrai URL HTTPS da mídia. Procura também dentro de `content` (Uazapi
 * v2 às vezes aninha media dentro de `message.content`).
 */
function extractMediaHttpUrl(m: UazapiV2Message): string | null {
  const bag = m as unknown as Record<string, unknown>;
  let cand = pickFirstString(bag, URL_KEYS);
  if (!cand) {
    const inner = bag.content;
    if (inner && typeof inner === "object") {
      cand = pickFirstString(inner as Record<string, unknown>, URL_KEYS);
    }
  }
  if (!cand) {
    const inner = bag.media;
    if (inner && typeof inner === "object") {
      cand = pickFirstString(inner as Record<string, unknown>, URL_KEYS);
    } else if (typeof inner === "string" && (inner.startsWith("http://") || inner.startsWith("https://"))) {
      cand = inner;
    }
  }
  if (cand && (cand.startsWith("http://") || cand.startsWith("https://"))) return cand;
  return null;
}

/**
 * Extrai base64 inline. Procura também dentro de `content` / `media`.
 * Retorna data URI completo (com mime).
 */
function extractMediaBase64(m: UazapiV2Message, mediaType: string): string | null {
  const bag = m as unknown as Record<string, unknown>;

  let raw = pickFirstString(bag, BASE64_KEYS);
  if (!raw) {
    const inner = bag.content;
    if (inner && typeof inner === "object") {
      raw = pickFirstString(inner as Record<string, unknown>, BASE64_KEYS);
    }
  }
  if (!raw) {
    const inner = bag.media;
    if (inner && typeof inner === "object") {
      raw = pickFirstString(inner as Record<string, unknown>, BASE64_KEYS);
    } else if (typeof inner === "string" && inner.length >= 64 && !inner.startsWith("http")) {
      // Pode ser base64 puro
      raw = inner;
    }
  }
  if (!raw || raw.length < 64) return null;

  if (raw.startsWith("data:")) return raw;

  const mime =
    pickFirstString(bag, MIME_KEYS) ||
    (mediaType === "audio"
      ? "audio/ogg"
      : mediaType === "image"
        ? "image/jpeg"
        : mediaType === "video"
          ? "video/mp4"
          : "application/octet-stream");

  return `data:${mime};base64,${raw}`;
}

/**
 * Extrai o caption/legenda da mídia (ou o texto da mensagem se for text-only).
 * Para document, o "content" também pode armazenar o filename como rótulo
 * exibido no preview do inbox.
 */
function extractTextContent(m: UazapiV2Message, mediaType: string): string | null {
  const direct = m.text ?? m.content?.text ?? m.caption ?? m.content?.caption;
  if (typeof direct === "string" && direct.trim()) return direct;

  if (mediaType === "document") {
    const bag = m as unknown as Record<string, unknown>;
    const fname = pickFirstString(bag, FILENAME_KEYS);
    if (fname) return fname;
  }
  return null;
}

/**
 * Normaliza mime "exótico" (audio/opus, audio/x-m4a, etc) para um valor
 * aceito pela allowlist do bucket Supabase `whatsapp-media`. Se nada bate,
 * cai pra `application/octet-stream` (também na allowlist).
 */
function normalizeMimeForStorage(mime: string, mediaType: string): string {
  const m = mime.toLowerCase();
  if (m === "audio/opus" || m === "audio/ogg") return "audio/ogg";
  if (m === "audio/x-m4a" || m === "audio/m4a") return "audio/mp4";
  if (m === "image/jpg") return "image/jpeg";
  // Allowlist conhecida — passa direto
  const allowed = new Set([
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
  ]);
  if (allowed.has(m)) return m;
  // Fallback por mediaType
  if (mediaType === "audio") return "audio/ogg";
  if (mediaType === "image") return "image/jpeg";
  if (mediaType === "video") return "video/mp4";
  if (mediaType === "sticker") return "image/webp";
  return "application/octet-stream";
}

/**
 * Pede pra Uazapi baixar e decriptar a mídia do WhatsApp (a URL crua que vem
 * no webhook é do CDN do WhatsApp e está encriptada com mediaKey — `.enc`).
 * Uazapi tem endpoint `POST /message/download {id}` que retorna `{fileURL, mimetype}`
 * já decriptado e servido pelo próprio servidor da instância.
 *
 * Retorna null se a chamada falhar.
 */
async function uazapiDownloadMedia(
  baseUrl: string,
  token: string,
  messageId: string
): Promise<{ fileURL: string; mimetype: string } | null> {
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/message/download`, {
      method: "POST",
      headers: { token, "Content-Type": "application/json" },
      body: JSON.stringify({ id: messageId }),
    });
    if (!r.ok) {
      console.warn(`[UAZAPI-V2] /message/download HTTP ${r.status} for ${messageId}`);
      return null;
    }
    const data = (await r.json()) as { fileURL?: string; mimetype?: string };
    if (!data.fileURL) return null;
    return { fileURL: data.fileURL, mimetype: data.mimetype ?? "application/octet-stream" };
  } catch (e) {
    console.warn(
      `[UAZAPI-V2] /message/download threw: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
}

/**
 * Faz download de URL HTTPS e devolve Buffer + mimetype.
 * Best-effort — retorna null se falhar.
 */
async function fetchMediaAsBuffer(
  url: string,
  authToken?: string
): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const headers: Record<string, string> = {};
    // Algumas Uazapi servem mídia atrás do mesmo token de instância.
    if (authToken) headers.token = authToken;

    const r = await fetch(url, { headers });
    if (!r.ok) {
      console.warn(`[UAZAPI-V2] media fetch HTTP ${r.status} for ${url.slice(0, 80)}`);
      return null;
    }
    const ab = await r.arrayBuffer();
    const buffer = Buffer.from(ab);
    const mime = r.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";
    return { buffer, mime };
  } catch (e) {
    console.warn(
      `[UAZAPI-V2] media fetch threw: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload: UazapiV2Payload = await request.json();
    const event = payload.EventType ?? "";
    const instanceName = payload.instanceName ?? "";

    if (!instanceName) return NextResponse.json({ ok: true });

    // Busca whatsapp_number pelo instance name (uazapiSession)
    const [wNum] = await db
      .select()
      .from(whatsappNumber)
      .where(eq(whatsappNumber.uazapiSession, instanceName))
      .limit(1);

    if (!wNum) {
      console.warn("[UAZAPI-V2] Instance not found:", instanceName);
      return NextResponse.json({ ok: true });
    }

    // Eventos de conexão
    if (event === "connection" || event === "qr") {
      // Sem ação por enquanto — instância já é gerenciada pelo painel Uazapi.
      return NextResponse.json({ ok: true });
    }

    // Só processamos eventos de mensagem
    if (event !== "messages" && event !== "messages_update") {
      console.log("[UAZAPI-V2] evento ignorado:", event);
      return NextResponse.json({ ok: true });
    }

    const msg = payload.message;
    const chat = payload.chat;
    if (!msg || !chat) return NextResponse.json({ ok: true });

    // Filtros básicos
    if (msg.fromMe) return NextResponse.json({ ok: true });

    const isGroup = msg.isGroup === true || chat.wa_isGroup === true;
    if (isGroup) return NextResponse.json({ ok: true });

    // JID do contato (preferimos wa_chatid; fallback msg.chatid)
    const contactJid = chat.wa_chatid ?? msg.chatid ?? "";
    if (!contactJid) return NextResponse.json({ ok: true });

    const contactPhone = extractPhone(contactJid);
    const mediaType = getMediaType(msg);
    const contentText = extractTextContent(msg, mediaType) ?? "";
    const pushName = chat.wa_contactName ?? chat.name ?? null;
    const profilePic = chat.imagePreview ?? null;

    // ── DEBUG: loga payload sempre que for mídia, pra confirmar shape real
    //          dos campos audio/image/video/document que a Uazapi v2 envia.
    //          Mantém o dump truncado em ~3000 chars (base64 fica enorme).
    if (mediaType !== "text") {
      try {
        const truncated = JSON.stringify(msg, (_k, v) => {
          if (typeof v === "string" && v.length > 200) {
            return `${v.slice(0, 200)}…[truncated len=${v.length}]`;
          }
          return v;
        });
        console.log(
          "[UAZAPI-V2 PAYLOAD]",
          JSON.stringify({
            event,
            instanceName,
            mediaType,
            messageKeys: Object.keys(msg),
            contentText,
            rawMessage: truncated.slice(0, 3000),
          })
        );
      } catch {
        /* noop */
      }
    }

    // Timestamp em ms (Uazapi v2 manda em ms direto)
    const ts = msg.messageTimestamp ? new Date(msg.messageTimestamp) : new Date();

    // Upsert conversation
    const existing = await db
      .select()
      .from(crmConversation)
      .where(
        and(
          eq(crmConversation.whatsappNumberId, wNum.id),
          eq(crmConversation.contactPhone, contactPhone)
        )
      )
      .limit(1);

    let conversationId: string;
    const now = new Date();

    if (existing[0]) {
      conversationId = existing[0].id;
      await db
        .update(crmConversation)
        .set({
          lastMessageAt: now,
          lastIncomingAt: now,
          unreadCount: existing[0].unreadCount + 1,
          contactPushName: pushName ?? existing[0].contactPushName,
          contactProfilePicUrl:
            profilePic && profilePic.startsWith("http")
              ? profilePic
              : existing[0].contactProfilePicUrl,
          updatedAt: now,
        })
        .where(eq(crmConversation.id, conversationId));
    } else {
      const [newConv] = await db
        .insert(crmConversation)
        .values({
          whatsappNumberId: wNum.id,
          tenantId: wNum.tenantId,
          contactPhone,
          contactJid,
          contactPushName: pushName,
          contactProfilePicUrl: profilePic && profilePic.startsWith("http") ? profilePic : null,
          classification: "new",
          isGroup: false,
          lastMessageAt: now,
          lastIncomingAt: now,
          unreadCount: 1,
        })
        .returning();
      conversationId = newConv.id;

      // Auto-cria lead + dispara welcome (best-effort)
      try {
        const [firstStage] = await db
          .select({ id: pipelineStage.id })
          .from(pipelineStage)
          .where(eq(pipelineStage.tenantId, wNum.tenantId))
          .orderBy(asc(pipelineStage.order))
          .limit(1);

        if (firstStage) {
          const inserted = await db
            .insert(lead)
            .values({
              tenantId: wNum.tenantId,
              name: pushName ?? contactPhone,
              phone: contactPhone,
              pushName,
              stageId: firstStage.id,
              source: "inbound",
              crmConversationId: conversationId,
            })
            .onConflictDoNothing()
            .returning({ id: lead.id });

          if (inserted.length > 0) {
            const newLead = inserted[0];
            try {
              await triggerFirstMessage({
                tenantId: wNum.tenantId,
                leadId: newLead.id,
              });
              await processPendingAutomations(10);
            } catch {
              // best-effort
            }
          }
        }
      } catch {
        // best-effort
      }
    }

    // ── Resolve mediaUrl pra mensagens de mídia ─────────────────────
    // Estratégia (em ordem):
    //   1. base64 inline (caso webhook configurado pra incluir) → upload Storage
    //   2. URL HTTPS direto (mediaUrl/fileURL/etc) → fetch+upload Storage
    //      (evita depender de URL externa que pode expirar / exigir auth)
    //   3. Como fallback, se conseguirmos URL HTTPS mas não baixar,
    //      armazenamos a URL direta (pode quebrar player se exigir auth).
    let finalMediaUrl: string | null = null;

    if (mediaType !== "text") {
      const dataUri = extractMediaBase64(msg, mediaType);
      let httpUrl = extractMediaHttpUrl(msg);

      // Para QUALQUER mídia, pede pra Uazapi baixar+decriptar via
      // /message/download. As URLs cruas que vêm no webhook são:
      //   - .enc encriptadas (CDN do WhatsApp, mmg.whatsapp.net)
      //   - "https://web.whatsapp.net" (placeholder pra stickers — não é URL real)
      //   - URLs que expiram (oh= queries com TTL curto)
      // O endpoint /message/download retorna URL HTTPS pública estável servida
      // pela própria instância Uazapi.
      const messageId = msg.messageid ?? msg.id;
      const tokenForApi =
        wNum.uazapiToken && wNum.uazapiToken !== "baileys" ? wNum.uazapiToken : undefined;
      const isUsableUrl =
        !!httpUrl &&
        !httpUrl.includes(".enc") &&
        !httpUrl.includes("mmg.whatsapp.net") &&
        httpUrl !== "https://web.whatsapp.net" &&
        !/\bwhatsapp\.net\/?$/.test(httpUrl);
      if (!dataUri && messageId && tokenForApi && payload.BaseUrl && !isUsableUrl) {
        const downloaded = await uazapiDownloadMedia(payload.BaseUrl, tokenForApi, messageId);
        if (downloaded?.fileURL) {
          httpUrl = downloaded.fileURL;
          console.log(
            `[UAZAPI-V2] mídia ${mediaType} decriptada via /message/download: ${downloaded.mimetype}`
          );
        }
      }

      if (dataUri) {
        // Normaliza mime no data URI antes de subir (audio/opus → audio/ogg etc).
        const m = dataUri.match(/^data:([^;,]+)(;[^,]*)?,(.+)$/);
        let toUpload = dataUri;
        if (m) {
          const normMime = normalizeMimeForStorage(m[1], mediaType);
          toUpload = `data:${normMime};base64,${m[3]}`;
        }
        const uploaded = await uploadWhatsappMedia({
          tenantId: wNum.tenantId,
          conversationId,
          data: toUpload,
        });
        if (uploaded) finalMediaUrl = uploaded.publicUrl;
      } else if (httpUrl) {
        // Só passa o token instance-specific (não o legacy "baileys" placeholder).
        const tokenForFetch = wNum.uazapiToken && wNum.uazapiToken !== "baileys" ? wNum.uazapiToken : undefined;
        const fetched = await fetchMediaAsBuffer(httpUrl, tokenForFetch);
        if (fetched) {
          // Normaliza mime pra cair na allowlist do bucket Supabase
          // (audio/opus → audio/ogg; audio/x-m4a → audio/mp4 etc).
          const normMime = normalizeMimeForStorage(fetched.mime, mediaType);
          const uploaded = await uploadWhatsappMedia({
            tenantId: wNum.tenantId,
            conversationId,
            data: fetched.buffer,
            mimetype: normMime,
          });
          if (uploaded) finalMediaUrl = uploaded.publicUrl;
        }
        // Fallback: salva a URL direta. O endpoint /messages/[id]/media
        // já trata redirect 302 pra URLs HTTPS externas.
        if (!finalMediaUrl) finalMediaUrl = httpUrl;
      }

      if (!finalMediaUrl) {
        console.warn(
          `[UAZAPI-V2] mídia ${mediaType} sem URL/base64 extraível — keys=${Object.keys(msg).join(",")}`
        );
      }
    }

    // Insere a mensagem (idempotente via messageid se existir)
    await db
      .insert(crmMessage)
      .values({
        conversationId,
        messageIdWa: msg.messageid ?? msg.id ?? null,
        direction: "incoming",
        content: contentText || null,
        mediaType,
        mediaUrl: finalMediaUrl,
        status: "delivered",
        senderName: chat.wa_name ?? pushName ?? null,
        timestamp: ts,
      })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[UAZAPI-V2] Webhook failed:", e);
    return NextResponse.json({ ok: true });
  }
}
