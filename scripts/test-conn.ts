import "dotenv/config";
import postgres from "postgres";

async function main() {
  console.log("DATABASE_URL host:", process.env.DATABASE_URL?.match(/@([^:]+)/)?.[1]);
  const t0 = Date.now();
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const [row] = await sql`SELECT 1 as ok`;
  console.log(`✓ Conectado em ${Date.now() - t0}ms, resultado:`, row);
  await sql.end();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
