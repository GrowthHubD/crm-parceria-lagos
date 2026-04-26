import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const GH = "00000000-0000-0000-0000-000000000001";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const wn = await sql<{ id: string; label: string; phone_number: string; uazapi_session: string; is_active: boolean; tlen: string | null }[]>`
    SELECT id, label, phone_number, uazapi_session, is_active, LENGTH(uazapi_token)::text AS tlen
    FROM public.whatsapp_number
    WHERE tenant_id = ${GH}
  `;
  console.log(`whatsapp_numbers do GH: ${wn.length}`);
  wn.forEach((w) =>
    console.log(`  ${w.label} | session=${w.uazapi_session} | phone=${w.phone_number} | active=${w.is_active} | tokenLen=${w.tlen}`)
  );
  await sql.end();
}
main().catch(console.error);
