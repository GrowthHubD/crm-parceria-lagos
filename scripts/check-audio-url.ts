import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const audios = await sql`
    SELECT id, direction, media_type, media_url, timestamp
    FROM public.crm_message
    WHERE media_type = 'audio'
    ORDER BY timestamp DESC
    LIMIT 5;
  `;

  console.log(`\n${audios.length} áudios recentes:\n`);
  for (const a of audios) {
    console.log(`[${a.direction}] timestamp=${a.timestamp}`);
    console.log(`  mediaUrl: ${a.media_url}`);
    if (a.media_url) {
      // Teste HEAD na URL
      try {
        const r = await fetch(a.media_url as string, { method: "HEAD" });
        console.log(`  HEAD response: ${r.status} content-type=${r.headers.get("content-type")} size=${r.headers.get("content-length")}`);
      } catch (e) {
        console.log(`  HEAD failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log();
  }

  await sql.end();
}

main().catch(console.error);
