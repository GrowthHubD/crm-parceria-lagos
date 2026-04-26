import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `;

  console.log(`\n✓ ${tables.length} tabelas no schema public:\n`);
  tables.forEach((t) => console.log(`  • ${t.table_name}`));

  const jobs = await sql`SELECT jobname, schedule, active FROM cron.job;`;
  console.log(`\n✓ ${jobs.length} jobs pg_cron:\n`);
  jobs.forEach((j) => console.log(`  • ${j.jobname} — ${j.schedule} — active=${j.active}`));

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
