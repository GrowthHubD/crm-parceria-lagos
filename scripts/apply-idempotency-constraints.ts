/**
 * Adiciona constraints de unicidade pra prevenir race conditions
 * na criação de lead + mensagem duplicada do Evolution/Uazapi.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  // 1) Limpa leads duplicados (tenant_id, phone) mantendo o mais antigo
  await sql.unsafe(`
    DELETE FROM public.lead a
    USING public.lead b
    WHERE a.tenant_id = b.tenant_id
      AND a.phone = b.phone
      AND a.phone IS NOT NULL
      AND a.created_at > b.created_at;
  `);
  console.log("✓ Leads duplicados limpos");

  // 2) UNIQUE em (tenant_id, phone) pra lead
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_tenant_phone
      ON public.lead(tenant_id, phone)
      WHERE phone IS NOT NULL;
  `);
  console.log("✓ UNIQUE(tenant_id, phone) em lead");

  // 3) Limpa crm_message com messageIdWa duplicado (mantém o mais antigo)
  await sql.unsafe(`
    DELETE FROM public.crm_message a
    USING public.crm_message b
    WHERE a.message_id_wa = b.message_id_wa
      AND a.message_id_wa IS NOT NULL
      AND a.id > b.id;
  `);
  console.log("✓ Mensagens Evolution duplicadas limpas");

  // 4) UNIQUE em message_id_wa
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_msg_wa_id
      ON public.crm_message(message_id_wa)
      WHERE message_id_wa IS NOT NULL;
  `);
  console.log("✓ UNIQUE(message_id_wa) em crm_message");

  // Dedup de welcome não pode ser via UNIQUE(auto, lead) no automation_log —
  // quebraria scheduled_recurring que cria múltiplos logs por (auto, lead).
  // Em vez disso: UNIQUE(tenant, phone) em lead garante que lead só existe 1x,
  // e autoCreateLead só chama triggerFirstMessage quando REALMENTE cria lead novo.

  await sql.end();
  console.log("\n✅ Constraints de idempotência aplicadas.");
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
