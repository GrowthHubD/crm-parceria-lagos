import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  // Reativa autos de usuário que foram indevidamente desativadas
  // (autos que NÃO têm dry_run=true e estão com is_active=false)
  const reactivated = await sql<{ id: string; name: string }[]>`
    UPDATE public.automation
    SET is_active = true, updated_at = now()
    WHERE is_active = false
      AND dry_run = false
    RETURNING id, name
  `;
  console.log(`Reativadas ${reactivated.length} automation(s):`);
  reactivated.forEach((r) => console.log(`  • ${r.name}`));

  await sql.end();
}
main().catch(console.error);
