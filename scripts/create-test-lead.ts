/**
 * Cria um lead "Teste Drag" com phone 5521978477520 no stage "Novo" do GH.
 * Se já existe (por phone), faz update pra resetar stage.
 *
 * Uso: npx tsx scripts/create-test-lead.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const GH = "00000000-0000-0000-0000-000000000001";
const PHONE = "5521978477520";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  // Pega o stage "Novo" do funil default
  const stages = await sql<{ id: string; name: string }[]>`
    SELECT s.id, s.name FROM public.pipeline_stage s
    JOIN public.pipeline p ON p.id = s.pipeline_id
    WHERE p.tenant_id = ${GH} AND p.is_default = true
    ORDER BY s."order" ASC
  `;
  if (stages.length === 0) {
    console.error("Nenhum stage no pipeline default do GH");
    process.exit(1);
  }
  const novoStage = stages[0];
  console.log(`Stage inicial: "${novoStage.name}" (${novoStage.id})`);

  // Verifica se lead já existe pra esse phone
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM public.lead WHERE tenant_id = ${GH} AND phone = ${PHONE}
  `;

  if (existing.length > 0) {
    const leadId = existing[0].id;
    await sql`
      UPDATE public.lead
      SET stage_id = ${novoStage.id}, updated_at = now()
      WHERE id = ${leadId}
    `;
    console.log(`✓ Lead existente atualizado: ${leadId} → stage "${novoStage.name}"`);
  } else {
    const [created] = await sql<{ id: string }[]>`
      INSERT INTO public.lead (tenant_id, name, phone, stage_id, source, created_at, updated_at)
      VALUES (${GH}, 'Teste Drag', ${PHONE}, ${novoStage.id}, 'inbound', now(), now())
      RETURNING id
    `;
    console.log(`✓ Lead criado: ${created.id} (Teste Drag, phone ${PHONE}, stage "${novoStage.name}")`);
  }

  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
