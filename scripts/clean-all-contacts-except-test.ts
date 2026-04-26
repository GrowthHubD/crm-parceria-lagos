/**
 * Limpa TODOS os contatos (leads + conversas + mensagens + logs de automação)
 * do tenant GH, EXCETO o lead de teste com phone 5521978477520.
 *
 * Uso: npx tsx scripts/clean-all-contacts-except-test.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const GH = "00000000-0000-0000-0000-000000000001";
const KEEP_PHONE = "5521978477520";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("=== Antes ===");
  const before = await sql<{ cnt: string }[]>`
    SELECT (SELECT COUNT(*)::text FROM public.lead WHERE tenant_id=${GH}) AS cnt
  `;
  const beforeConvs = await sql<{ cnt: string }[]>`
    SELECT (SELECT COUNT(*)::text FROM public.crm_conversation WHERE tenant_id=${GH}) AS cnt
  `;
  console.log(`  leads: ${before[0].cnt}`);
  console.log(`  conversations: ${beforeConvs[0].cnt}`);

  // IDs a preservar
  const keepLeads = await sql<{ id: string }[]>`
    SELECT id FROM public.lead WHERE tenant_id=${GH} AND phone=${KEEP_PHONE}
  `;
  const keepLeadIds = keepLeads.map((r) => r.id);
  const keepConvs = await sql<{ id: string }[]>`
    SELECT id FROM public.crm_conversation WHERE tenant_id=${GH} AND contact_phone=${KEEP_PHONE}
  `;
  const keepConvIds = keepConvs.map((r) => r.id);

  console.log(`\nPreservando: ${keepLeadIds.length} lead(s), ${keepConvIds.length} conversa(s)`);

  // ─── DELETE tudo que não é pro keep ───
  // 1. automation_log dos leads a deletar
  const leadsToDelete = await sql<{ id: string }[]>`
    SELECT id FROM public.lead WHERE tenant_id=${GH} AND (phone IS NULL OR phone != ${KEEP_PHONE})
  `;
  const delIds = leadsToDelete.map((l) => l.id);
  if (delIds.length > 0) {
    const dlLogs = await sql`DELETE FROM public.automation_log WHERE lead_id = ANY(${delIds}::uuid[])`;
    console.log(`  automation_log: ${dlLogs.count} deletados`);
  }

  // 2. crm_message das conversas a deletar
  const convsToDelete = await sql<{ id: string }[]>`
    SELECT id FROM public.crm_conversation WHERE tenant_id=${GH} AND contact_phone != ${KEEP_PHONE}
  `;
  const dConvIds = convsToDelete.map((c) => c.id);
  if (dConvIds.length > 0) {
    const dlMsgs = await sql`DELETE FROM public.crm_message WHERE conversation_id = ANY(${dConvIds}::uuid[])`;
    console.log(`  crm_message: ${dlMsgs.count} deletadas`);
  }

  // 3. leads
  if (delIds.length > 0) {
    const dlLeads = await sql`DELETE FROM public.lead WHERE id = ANY(${delIds}::uuid[])`;
    console.log(`  lead: ${dlLeads.count} deletados`);
  }

  // 4. conversations
  if (dConvIds.length > 0) {
    const dlConvs = await sql`DELETE FROM public.crm_conversation WHERE id = ANY(${dConvIds}::uuid[])`;
    console.log(`  crm_conversation: ${dlConvs.count} deletadas`);
  }

  console.log("\n=== Depois ===");
  const afterLeads = await sql<{ id: string; name: string; phone: string }[]>`
    SELECT id, name, phone FROM public.lead WHERE tenant_id=${GH}
  `;
  console.log(`  leads restantes: ${afterLeads.length}`);
  afterLeads.forEach((l) => console.log(`    • ${l.name} (${l.phone})`));

  const afterConvs = await sql<{ contact_phone: string }[]>`
    SELECT contact_phone FROM public.crm_conversation WHERE tenant_id=${GH}
  `;
  console.log(`  conversations restantes: ${afterConvs.length}`);
  afterConvs.forEach((c) => console.log(`    • ${c.contact_phone}`));

  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
