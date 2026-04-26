import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const logs = await sql`
    SELECT a.name AS auto_name, l.status, l.dry_run, l.created_at, l.executed_at, ld.name AS lead_name, l.error
    FROM public.automation_log l
    JOIN public.automation a ON a.id = l.automation_id
    LEFT JOIN public.lead ld ON ld.id = l.lead_id
    WHERE l.created_at > now() - interval '5 minutes'
    ORDER BY l.created_at DESC
  `;
  console.log(`Logs recentes (últimos 5 min): ${logs.length}`);
  logs.forEach((x: { auto_name: string; status: string; dry_run: boolean; executed_at: Date | null; lead_name: string | null; error: string | null }) =>
    console.log(`  ${x.auto_name} → ${x.lead_name ?? "?"} | ${x.status} dry=${x.dry_run} exec=${x.executed_at?.toISOString?.().slice(11, 19) ?? "-"} ${x.error ?? ""}`)
  );
  await sql.end();
}
main().catch(console.error);
