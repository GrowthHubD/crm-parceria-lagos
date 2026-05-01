/**
 * Adiciona unique constraint em (conversation_id, message_id_wa) na tabela
 * crm_message — defesa em profundidade contra duplicação de mensagens recebidas
 * via webhook (mesmo messageId chega 2x se Uazapi reenviar antes do ack).
 *
 * Postgres trata NULLs como distintos em UNIQUE por default, então mensagens
 * legadas sem messageIdWa não conflitam entre si.
 *
 * Uso:
 *   npx tsx scripts/apply-message-dedup-index.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  // 1) Limpa duplicatas existentes (mantém a mais antiga por chave)
  console.log("→ Removendo crm_message duplicados por (conversation_id, message_id_wa)...");
  const deleted = await sql.unsafe(`
    DELETE FROM public.crm_message a
    USING public.crm_message b
    WHERE a.conversation_id = b.conversation_id
      AND a.message_id_wa IS NOT NULL
      AND b.message_id_wa IS NOT NULL
      AND a.message_id_wa = b.message_id_wa
      AND a.id > b.id
    RETURNING a.id;
  `);
  console.log(`  ✓ ${deleted.length} mensagens duplicadas removidas`);

  // 2) Cria a constraint
  console.log("→ Criando unique constraint uq_crm_message_id_wa...");
  await sql.unsafe(`
    ALTER TABLE public.crm_message
      DROP CONSTRAINT IF EXISTS uq_crm_message_id_wa;
    ALTER TABLE public.crm_message
      ADD CONSTRAINT uq_crm_message_id_wa
      UNIQUE (conversation_id, message_id_wa);
  `);

  // 3) Verifica
  const cons = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'uq_crm_message_id_wa';
  `;
  console.log("\n✓ Constraint ativa:");
  cons.forEach((c) => console.log(`  ${c.conname}: ${c.def}`));

  await sql.end();
  console.log("\n✅ Dedup de mensagens garantida ao nível do banco.");
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
