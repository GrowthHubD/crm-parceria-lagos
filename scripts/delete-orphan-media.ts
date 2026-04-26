import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const deleted = await sql`
    DELETE FROM public.crm_message
    WHERE media_type IN ('audio','image','video','document')
      AND media_url IS NULL
    RETURNING id;
  `;
  console.log(`✓ ${deleted.length} mensagens órfãs (mídia sem URL) deletadas`);
  await sql.end();
}
main().catch(console.error);
