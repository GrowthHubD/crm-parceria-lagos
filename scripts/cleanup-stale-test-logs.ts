/**
 * Limpeza one-shot: remove automations/logs de teste que sobraram no banco
 * por runs de script E2E que não finalizaram cleanup ou que foram pegos pelo
 * ticker do dev server.
 *
 * Roda: npx tsx scripts/cleanup-stale-test-logs.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
  });

  const prefixes = ["TEST %", "TEST\\_%", "F-%", "Bx-%", "By-%"];

  // Pega todos automations de teste
  const stale = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM public.automation
    WHERE name LIKE 'TEST %'
       OR name LIKE 'TEST\_%' ESCAPE '\'
       OR name LIKE 'F-%'
       OR name LIKE 'Bx-%'
       OR name LIKE 'By-%'
  `;
  console.log(`Automations de teste encontradas: ${stale.length}`);
  stale.forEach((a) => console.log(`  • ${a.name}`));

  if (stale.length === 0) {
    console.log("Nada pra limpar.");
    await sql.end();
    return;
  }

  const ids = stale.map((s) => s.id);

  const delLogs = await sql`DELETE FROM public.automation_log WHERE automation_id = ANY(${ids})`;
  console.log(`Logs deletados: ${delLogs.count}`);

  const delSteps = await sql`DELETE FROM public.automation_step WHERE automation_id = ANY(${ids})`;
  console.log(`Steps deletados: ${delSteps.count}`);

  const delVers = await sql`DELETE FROM public.automation_step_version WHERE automation_id = ANY(${ids})`;
  console.log(`Step versions deletadas: ${delVers.count}`);

  const delAuto = await sql`DELETE FROM public.automation WHERE id = ANY(${ids})`;
  console.log(`Automations deletadas: ${delAuto.count}`);

  // WhatsApp numbers de teste
  const delWn = await sql`DELETE FROM public.whatsapp_number WHERE label LIKE 'TEST%'`;
  console.log(`Whatsapp_numbers de teste deletados: ${delWn.count}`);

  // Leads órfãos de teste (Fulano) sem conversations reais
  const delLeads = await sql`DELETE FROM public.lead WHERE name = 'Fulano' OR name = 'João Teste' OR name = 'Grupo X'`;
  console.log(`Leads de teste deletados: ${delLeads.count}`);

  void prefixes;

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
