import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState,
  type BaileysEventMap,
  type AuthenticationCreds,
  type SignalKeyStoreWithTransaction,
  BufferJSON,
  initAuthCreds,
  proto,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { db } from "./db";
import { baileysAuthState, whatsappNumber, crmConversation, crmMessage } from "./db/schema/crm";
import { lead, pipelineStage } from "./db/schema/pipeline";
import { eq, and, asc } from "drizzle-orm";
import * as QRCode from "qrcode";

// ============================================
// Types
// ============================================

interface BaileysInstance {
  socket: WASocket;
  qrCode: string | null;
  status: "connecting" | "connected" | "disconnected";
  phoneNumber: string | null;
}

// ============================================
// Singleton pool — sobrevive ao HMR do Turbopack via globalThis
// ============================================

const g = globalThis as typeof globalThis & {
  _baileysInstances?: Map<string, BaileysInstance>;
};
if (!g._baileysInstances) g._baileysInstances = new Map();
const instances = g._baileysInstances;

const logger = pino({ level: "warn" });

// ============================================
// PostgreSQL Auth State
// ============================================

async function usePostgresAuthState(whatsappNumberId: string) {
  // Load creds
  const loadCreds = async (): Promise<AuthenticationCreds> => {
    const [row] = await db
      .select({ value: baileysAuthState.value })
      .from(baileysAuthState)
      .where(
        and(
          eq(baileysAuthState.whatsappNumberId, whatsappNumberId),
          eq(baileysAuthState.key, "creds")
        )
      )
      .limit(1);

    if (row) {
      return JSON.parse(row.value, BufferJSON.reviver);
    }
    return initAuthCreds();
  };

  const saveCreds = async (creds: AuthenticationCreds) => {
    const value = JSON.stringify(creds, BufferJSON.replacer);
    await db
      .insert(baileysAuthState)
      .values({ whatsappNumberId, key: "creds", value })
      .onConflictDoUpdate({
        target: [baileysAuthState.whatsappNumberId, baileysAuthState.key],
        set: { value, updatedAt: new Date() },
      });
  };

  // Key store — read/write signal keys
  const readKey = async (key: string): Promise<unknown | null> => {
    const [row] = await db
      .select({ value: baileysAuthState.value })
      .from(baileysAuthState)
      .where(
        and(
          eq(baileysAuthState.whatsappNumberId, whatsappNumberId),
          eq(baileysAuthState.key, key)
        )
      )
      .limit(1);

    return row ? JSON.parse(row.value, BufferJSON.reviver) : null;
  };

  const writeKey = async (key: string, data: unknown) => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await db
      .insert(baileysAuthState)
      .values({ whatsappNumberId, key, value })
      .onConflictDoUpdate({
        target: [baileysAuthState.whatsappNumberId, baileysAuthState.key],
        set: { value, updatedAt: new Date() },
      });
  };

  const removeKey = async (key: string) => {
    await db
      .delete(baileysAuthState)
      .where(
        and(
          eq(baileysAuthState.whatsappNumberId, whatsappNumberId),
          eq(baileysAuthState.key, key)
        )
      );
  };

  const creds = await loadCreds();

  const keys: SignalKeyStoreWithTransaction = {
    get: async (type: string, ids: string[]) => {
      const result: Record<string, unknown> = {};
      for (const id of ids) {
        const val = await readKey(`${type}-${id}`);
        if (val) result[id] = val;
      }
      return result;
    },
    set: async (data: Record<string, Record<string, unknown>>) => {
      for (const [type, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries)) {
          if (value) {
            await writeKey(`${type}-${id}`, value);
          } else {
            await removeKey(`${type}-${id}`);
          }
        }
      }
    },
    isInTransaction: () => false,
    prefetch: async () => {},
    transaction: async (fn) => await fn(),
  };

  return {
    state: { creds, keys: makeCacheableSignalKeyStore(keys, logger) },
    saveCreds,
  };
}

// ============================================
// Criar / obter instância Baileys
// ============================================

export async function getBaileysInstance(whatsappNumberId: string): Promise<BaileysInstance | null> {
  const existing = instances.get(whatsappNumberId);
  if (existing) return existing;
  return null;
}

export async function clearBaileysAuth(whatsappNumberId: string): Promise<void> {
  const existing = instances.get(whatsappNumberId);
  if (existing) {
    try {
      existing.socket?.end?.(undefined);
    } catch {
      // ignore
    }
    instances.delete(whatsappNumberId);
  }

  await db
    .delete(baileysAuthState)
    .where(eq(baileysAuthState.whatsappNumberId, whatsappNumberId));

  await db
    .update(whatsappNumber)
    .set({ isActive: false })
    .where(eq(whatsappNumber.id, whatsappNumberId));
}

export async function connectBaileys(
  whatsappNumberId: string,
  opts: { forceFresh?: boolean } = {}
): Promise<BaileysInstance> {
  if (opts.forceFresh) {
    await clearBaileysAuth(whatsappNumberId);
  }

  // Se já existe, retornar
  const existing = instances.get(whatsappNumberId);
  if (existing && existing.status !== "disconnected") return existing;

  // Verificar que o whatsappNumber existe no banco
  const [wNum] = await db
    .select()
    .from(whatsappNumber)
    .where(eq(whatsappNumber.id, whatsappNumberId))
    .limit(1);

  if (!wNum) throw new Error("WhatsApp number not found");

  const instance: BaileysInstance = {
    socket: null as unknown as WASocket,
    qrCode: null,
    status: "connecting",
    phoneNumber: null,
  };
  instances.set(whatsappNumberId, instance);

  const { state, saveCreds } = await usePostgresAuthState(whatsappNumberId);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["CRM GrowthHub", "Chrome", "1.0.0"],
    generateHighQualityLinkPreview: false,
  });

  instance.socket = socket;

  // ── Connection updates (QR code, connected, etc.) ──
  socket.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Gerar QR code como data URL para o frontend
      try {
        instance.qrCode = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      } catch {
        instance.qrCode = qr;
      }
      instance.status = "connecting";
    }

    if (connection === "open") {
      instance.status = "connected";
      instance.qrCode = null;

      // Extrair número do telefone
      const jid = socket.user?.id;
      const phone = jid?.replace(/:.*$/, "").replace(/@.*$/, "") ?? null;
      instance.phoneNumber = phone;

      // Atualizar banco
      if (phone) {
        await db
          .update(whatsappNumber)
          .set({ phoneNumber: phone, isActive: true })
          .where(eq(whatsappNumber.id, whatsappNumberId));
      }
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })
        ?.output?.statusCode;

      instance.status = "disconnected";

      if (statusCode !== DisconnectReason.loggedOut) {
        // Reconectar automaticamente
        instances.delete(whatsappNumberId);
        setTimeout(() => connectBaileys(whatsappNumberId), 3000);
      } else {
        // Deslogado — limpar auth state
        instances.delete(whatsappNumberId);
        await db
          .delete(baileysAuthState)
          .where(eq(baileysAuthState.whatsappNumberId, whatsappNumberId));
        await db
          .update(whatsappNumber)
          .set({ isActive: false })
          .where(eq(whatsappNumber.id, whatsappNumberId));
      }
    }
  });

  // ── Salvar credenciais ──
  socket.ev.on("creds.update", saveCreds);

  // ── Mensagens recebidas ──
  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.key.remoteJid || msg.key.remoteJid.includes("@g.us")) continue; // Ignorar grupos

      const contactPhone = msg.key.remoteJid.replace(/@.*$/, "").replace(/[^0-9]/g, "");
      const pushName = msg.pushName ?? null;
      const content = extractMessageContent(msg);
      const mediaType = extractMediaType(msg);

      try {
        // Upsert conversa
        const [conv] = await db
          .insert(crmConversation)
          .values({
            tenantId: wNum.tenantId,
            whatsappNumberId,
            contactPhone,
            contactName: pushName,
            contactPushName: pushName,
            lastMessageAt: new Date(),
            unreadCount: 1,
          })
          .onConflictDoUpdate({
            target: [crmConversation.whatsappNumberId, crmConversation.contactPhone],
            set: {
              lastMessageAt: new Date(),
              unreadCount: 1, // TODO: increment
              contactPushName: pushName ?? undefined,
              updatedAt: new Date(),
            },
          })
          .returning();

        // Salvar mensagem
        await db.insert(crmMessage).values({
          conversationId: conv.id,
          messageIdWa: msg.key.id ?? null,
          direction: "incoming",
          content,
          mediaType,
          status: "delivered",
        });

        // Auto-criar lead (best-effort)
        await autoCreateLead(wNum.tenantId, contactPhone, pushName);
      } catch (e) {
        console.error("[BAILEYS] Error processing message:", e);
      }
    }
  });

  return instance;
}

// ── Enviar mensagem ──
export async function sendWhatsAppMessage(
  whatsappNumberId: string,
  phone: string,
  message: string
): Promise<{ messageId?: string }> {
  const instance = instances.get(whatsappNumberId);
  if (!instance || instance.status !== "connected") {
    throw new Error("WhatsApp não conectado");
  }

  const jid = phone.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
  const result = await instance.socket.sendMessage(jid, { text: message });
  return { messageId: result?.key?.id ?? undefined };
}

// ── Desconectar ──
export async function disconnectBaileys(whatsappNumberId: string) {
  const instance = instances.get(whatsappNumberId);
  if (instance) {
    instance.socket.end(undefined);
    instances.delete(whatsappNumberId);
  }
}

// ============================================
// Helpers
// ============================================

function extractMessageContent(msg: proto.IWebMessageInfo): string | null {
  const m = msg.message;
  if (!m) return null;

  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.documentMessage?.fileName) return m.documentMessage.fileName;

  return null;
}

function extractMediaType(msg: proto.IWebMessageInfo): string {
  const m = msg.message;
  if (!m) return "text";

  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.audioMessage) return "audio";
  if (m.documentMessage) return "document";

  return "text";
}

async function autoCreateLead(tenantId: string, phone: string, name: string | null) {
  try {
    // Verificar se já existe lead com esse telefone
    const [existing] = await db
      .select({ id: lead.id })
      .from(lead)
      .where(and(eq(lead.tenantId, tenantId), eq(lead.phone, phone)))
      .limit(1);

    if (existing) return;

    // Buscar primeiro stage do pipeline default
    const [firstStage] = await db
      .select({ id: pipelineStage.id })
      .from(pipelineStage)
      .where(eq(pipelineStage.tenantId, tenantId))
      .orderBy(asc(pipelineStage.order))
      .limit(1);

    if (!firstStage) return;

    await db.insert(lead).values({
      tenantId,
      name: name || phone,
      phone,
      stageId: firstStage.id,
      source: "whatsapp",
      pushName: name,
    });
  } catch {
    // Best-effort — não falhar se lead já existe
  }
}

// ============================================
// Reconectar instâncias ativas ao iniciar
// ============================================

export async function reconnectActiveInstances() {
  try {
    const activeInstances = await db
      .select({ id: whatsappNumber.id })
      .from(whatsappNumber)
      .where(eq(whatsappNumber.isActive, true));

    for (const inst of activeInstances) {
      // Verificar se tem auth state salvo
      const [hasCreds] = await db
        .select({ id: baileysAuthState.id })
        .from(baileysAuthState)
        .where(
          and(
            eq(baileysAuthState.whatsappNumberId, inst.id),
            eq(baileysAuthState.key, "creds")
          )
        )
        .limit(1);

      if (hasCreds) {
        connectBaileys(inst.id).catch((e) =>
          console.error(`[BAILEYS] Failed to reconnect ${inst.id}:`, e)
        );
      }
    }
  } catch (e) {
    console.error("[BAILEYS] Reconnect failed:", e);
  }
}
