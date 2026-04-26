/**
 * Limpa as conversations + messages + leads do tenant GH
 * pra permitir testar welcome automation do zero.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const GH = "00000000-0000-0000-0000-000000000001";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const msgs = await sql`
    DELETE FROM public.crm_message
    WHERE conversation_id IN (
      SELECT id FROM public.crm_conversation WHERE tenant_id = ${GH}
    )
    RETURNING id;
  `;
  console.log(`✓ ${msgs.length} mensagens deletadas`);

  // Desvincular leads das conversations antes de deletar
  const leads = await sql`
    DELETE FROM public.lead
    WHERE tenant_id = ${GH}
    RETURNING id;
  `;
  console.log(`✓ ${leads.length} leads deletados`);

  const convs = await sql`
    DELETE FROM public.crm_conversation
    WHERE tenant_id = ${GH}
    RETURNING id;
  `;
  console.log(`✓ ${convs.length} conversations deletadas`);

  const logs = await sql`
    DELETE FROM public.automation_log
    WHERE automation_id IN (
      SELECT id FROM public.automation WHERE tenant_id = ${GH}
    )
    RETURNING id;
  `;
  console.log(`✓ ${logs.length} automation_logs deletados`);

  await sql.end();
  console.log("\n✅ Limpo. Manda mensagem NOVA pro 5521991083870 que a welcome deve disparar.");
}

main().catch((e) => { console.error(e); process.exit(1); });
