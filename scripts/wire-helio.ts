/**
 * Vincula a instância Evolution "Helio" (já conectada — 5521991083870)
 * ao tenant GH como whatsapp_number ativo.
 *
 * Depois de rodar, em /crm aparece o inbox dessa conta.
 * Envio de mensagens funciona imediatamente (sem QR).
 * Recebimento precisa do webhook Evolution apontar pro app — ver notas no final.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { whatsappNumber } from "../src/lib/db/schema/crm";
import { tenant } from "../src/lib/db/schema/tenants";

const GH_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const EVOLUTION_INSTANCE_NAME = "Helio";
const PHONE_NUMBER = "5521991083870";

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
  });
  const db = drizzle(sql);

  // Verifica se já existe whatsapp_number pro GH
  const [existing] = await db
    .select()
    .from(whatsappNumber)
    .where(eq(whatsappNumber.tenantId, GH_TENANT_ID))
    .limit(1);

  let wnumId: string;

  if (existing) {
    await db
      .update(whatsappNumber)
      .set({
        label: "Helio (dev)",
        phoneNumber: PHONE_NUMBER,
        uazapiSession: EVOLUTION_INSTANCE_NAME,
        uazapiToken: process.env.EVOLUTION_API_KEY ?? "",
        isActive: true,
      })
      .where(eq(whatsappNumber.id, existing.id));
    wnumId = existing.id;
    console.log(`✓ whatsapp_number atualizado (id=${wnumId})`);
  } else {
    const [created] = await db
      .insert(whatsappNumber)
      .values({
        tenantId: GH_TENANT_ID,
        label: "Helio (dev)",
        phoneNumber: PHONE_NUMBER,
        uazapiSession: EVOLUTION_INSTANCE_NAME,
        uazapiToken: process.env.EVOLUTION_API_KEY ?? "",
        isActive: true,
      })
      .returning({ id: whatsappNumber.id });
    wnumId = created.id;
    console.log(`✓ whatsapp_number criado (id=${wnumId})`);
  }

  // Atualiza tenant pra apontar pra esse whatsapp como principal
  await db
    .update(tenant)
    .set({ uazapiInstanceId: wnumId, updatedAt: new Date() })
    .where(eq(tenant.id, GH_TENANT_ID));
  console.log("✓ tenant GH apontando pra Helio como whatsapp principal");

  await sql.end();

  console.log("\n✅ Helio conectado ao tenant GH.\n");
  console.log("Teste agora em http://localhost:3000/crm:");
  console.log("  • Inbox deve aparecer com a conta Helio (5521991083870)");
  console.log("  • Abrir conversa existente → digitar → enviar:");
  console.log("    → mensagem chega no celular do número alvo");
  console.log("\n⚠ IMPORTANTE — pra RECEBER mensagens (webhook):");
  console.log("   O Evolution precisa POST em /api/webhooks/evolution");
  console.log("   Como está em localhost, precisa expor publicamente:");
  console.log("     • Opção A: ngrok http 3000");
  console.log("     • Opção B: cloudflared tunnel --url http://localhost:3000");
  console.log("     • Opção C: testar envio primeiro (não precisa webhook)");
  console.log("   Depois atualizar o webhook da instância no Evolution:");
  console.log("     curl -X POST 'https://evolution.iacompanyhorizon.com.br/webhook/set/Helio' \\");
  console.log("       -H 'apikey: <EVOLUTION_API_KEY>' \\");
  console.log("       -H 'Content-Type: application/json' \\");
  console.log("       -d '{\"webhook\":{\"enabled\":true,\"url\":\"<SUA_URL_PUBLICA>/api/webhooks/evolution\",\"events\":[\"MESSAGES_UPSERT\",\"CONNECTION_UPDATE\"]}}'");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
