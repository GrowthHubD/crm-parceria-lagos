/**
 * Limpa logs de follow-up `failed`/`skipped` do tenant GH pra permitir retry
 * limpo após bug fix. Não toca em sent/pending/processing.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const GH = "00000000-0000-0000-0000-000000000001";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const deleted = await sql`
    DELETE FROM public.automation_log al
    USING public.automation a
    WHERE al.automation_id = a.id
      AND a.tenant_id = ${GH}
      AND a.trigger_type = 'lead_inactive'
      AND al.status IN ('failed', 'skipped')
    RETURNING al.id
  `;
  console.log(`Deletados: ${deleted.length} logs failed/skipped`);
  await sql.end();
}
main().catch(console.error);
