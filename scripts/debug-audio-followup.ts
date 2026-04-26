import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("\n=== Áudios recentes ===");
  const audios = await sql`
    SELECT id, direction, media_type, media_url, content, timestamp
    FROM public.crm_message
    WHERE media_type = 'audio'
    ORDER BY timestamp DESC
    LIMIT 5;
  `;
  audios.forEach((a) => {
    console.log(`  [${a.direction}] ${a.media_type} — url=${String(a.media_url).slice(0, 80)}...`);
  });

  console.log("\n=== Leads (crmConversationId?) ===");
  const leads = await sql`
    SELECT l.id, l.name, l.phone, l.crm_conversation_id, c.id as conv_id, c.last_outgoing_at, c.last_incoming_at
    FROM public.lead l
    LEFT JOIN public.crm_conversation c ON c.whatsapp_number_id IN (
      SELECT id FROM public.whatsapp_number WHERE tenant_id = l.tenant_id
    ) AND c.contact_phone = l.phone
    WHERE l.tenant_id = '00000000-0000-0000-0000-000000000001';
  `;
  leads.forEach((l) => {
    console.log(`  • ${l.name} (${l.phone})`);
    console.log(`    lead.crm_conversation_id = ${l.crm_conversation_id ?? 'NULL'}`);
    console.log(`    conv encontrada via whatsapp_number = ${l.conv_id ?? 'NULL'}`);
    console.log(`    last_outgoing_at = ${l.last_outgoing_at}`);
    console.log(`    last_incoming_at = ${l.last_incoming_at}`);
  });

  await sql.end();
}

main().catch(console.error);
