import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const msgs = await sql`
    SELECT m.id, m.direction, m.content, m.status, m.timestamp, m.message_id_wa
    FROM public.crm_message m
    JOIN public.crm_conversation c ON c.id = m.conversation_id
    WHERE c.contact_phone = '5521978477520'
    ORDER BY m.timestamp DESC
    LIMIT 10
  `;
  console.log(`msgs=${msgs.length}`);
  msgs.forEach((m: { id: string; direction: string; content: string | null; status: string; timestamp: Date; message_id_wa: string | null }) =>
    console.log(`  ${m.direction} | ${m.status} | ts=${new Date(m.timestamp).toISOString().slice(11, 19)} | waId=${m.message_id_wa ?? "null"} | ${(m.content ?? "").slice(0, 60)}`)
  );
  await sql.end();
}
main().catch(console.error);
