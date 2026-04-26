import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  index,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { leadTag } from "./pipeline";
import { tenant } from "./tenants";

// ============================================
// CRM / WHATSAPP
// ============================================

export const whatsappNumber = pgTable("whatsapp_number", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "restrict" }),
  phoneNumber: text("phone_number").notNull().unique(),
  label: text("label").notNull(),
  // Baileys auth — session state armazenado em baileys_auth_state
  uazapiSession: text("uazapi_session").notNull().default("baileys"), // legacy compat
  uazapiToken: text("uazapi_token").notNull().default("baileys"),     // legacy compat
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const baileysAuthState = pgTable(
  "baileys_auth_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    whatsappNumberId: uuid("whatsapp_number_id")
      .notNull()
      .references(() => whatsappNumber.id, { onDelete: "cascade" }),
    key: text("key").notNull(),       // 'creds' ou 'app-state-sync-key-xxx', 'pre-key-xxx', etc.
    value: text("value").notNull(),   // JSON serializado com BufferJSON
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_baileys_auth_key").on(table.whatsappNumberId, table.key),
    index("idx_baileys_auth_wn").on(table.whatsappNumberId),
  ]
);

export const crmConversation = pgTable(
  "crm_conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "restrict" }),
    whatsappNumberId: uuid("whatsapp_number_id")
      .notNull()
      .references(() => whatsappNumber.id),
    contactPhone: text("contact_phone").notNull(),
    contactJid: text("contact_jid"),
    contactName: text("contact_name"),
    contactPushName: text("contact_push_name"),
    classification: text("classification").notNull().default("new"), // 'hot', 'warm', 'cold', 'active_client', 'new'
    isGroup: boolean("is_group").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastIncomingAt: timestamp("last_incoming_at", { withTimezone: true }),
    lastOutgoingAt: timestamp("last_outgoing_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    contactProfilePicUrl: text("contact_profile_pic_url"),
    contactAlias: text("contact_alias"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_conversation_number_contact").on(table.whatsappNumberId, table.contactPhone),
    index("idx_crm_conversation_classification").on(table.classification),
  ]
);

export const crmMessage = pgTable(
  "crm_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => crmConversation.id, { onDelete: "cascade" }),
    messageIdWa: text("message_id_wa"),
    direction: text("direction").notNull(), // 'incoming', 'outgoing'
    content: text("content"),
    mediaType: text("media_type"), // 'text', 'image', 'audio', 'video', 'document'
    mediaUrl: text("media_url"),
    status: text("status").default("sent"), // 'sent', 'delivered', 'read', 'failed'
    quotedMessageId: text("quoted_message_id"),
    quotedContent: text("quoted_content"),
    senderName: text("sender_name"), // for group messages: display name of sender
    isStarred: boolean("is_starred").notNull().default(false),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_crm_message_conversation").on(table.conversationId),
    index("idx_crm_message_timestamp").on(table.timestamp),
  ]
);

export const crmConversationTag = pgTable(
  "crm_conversation_tag",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => crmConversation.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => leadTag.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.tagId] }),
  ]
);

// ============================================
// Relations
// ============================================

export const whatsappNumberRelations = relations(whatsappNumber, ({ one, many }) => ({
  tenant: one(tenant, { fields: [whatsappNumber.tenantId], references: [tenant.id] }),
  conversations: many(crmConversation),
}));

export const crmConversationRelations = relations(crmConversation, ({ one, many }) => ({
  tenant: one(tenant, { fields: [crmConversation.tenantId], references: [tenant.id] }),
  whatsappNumber: one(whatsappNumber, {
    fields: [crmConversation.whatsappNumberId],
    references: [whatsappNumber.id],
  }),
  messages: many(crmMessage),
  tags: many(crmConversationTag),
}));

export const crmMessageRelations = relations(crmMessage, ({ one }) => ({
  conversation: one(crmConversation, {
    fields: [crmMessage.conversationId],
    references: [crmConversation.id],
  }),
}));

export const crmConversationTagRelations = relations(crmConversationTag, ({ one }) => ({
  conversation: one(crmConversation, {
    fields: [crmConversationTag.conversationId],
    references: [crmConversation.id],
  }),
  tag: one(leadTag, {
    fields: [crmConversationTag.tagId],
    references: [leadTag.id],
  }),
}));
