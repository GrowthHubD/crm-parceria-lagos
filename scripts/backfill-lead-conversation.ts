/**
 * Popula lead.crm_conversation_id pra leads que foram criados sem esse link.
 * Match: mesmo tenant + mesmo phone + whatsapp_number do tenant.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const before = await sql`SELECT COUNT(*)::int AS n FROM public.lead WHERE crm_conversation_id IS NULL;`;
  console.log(`→ ${before[0].n} leads com crm_conversation_id NULL`);

  const updated = await sql.unsafe(`
    UPDATE public.lead l
    SET crm_conversation_id = c.id
    FROM public.crm_conversation c
    JOIN public.whatsapp_number w ON w.id = c.whatsapp_number_id
    WHERE l.crm_conversation_id IS NULL
      AND w.tenant_id = l.tenant_id
      AND c.contact_phone = l.phone
    RETURNING l.id;
  `);
  console.log(`✓ ${updated.length} leads atualizados`);

  const after = await sql`SELECT COUNT(*)::int AS n FROM public.lead WHERE crm_conversation_id IS NULL;`;
  console.log(`→ Sobraram ${after[0].n} leads órfãos (sem conv match)`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
