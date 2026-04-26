import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  try {
    const convIds = ["a9bade4a-715f-40d4-812a-cb765cf8ec66"];
    const rows = await sql`
      SELECT DISTINCT ON (conversation_id)
        conversation_id, content, media_type, direction, "timestamp"
      FROM public.crm_message
      WHERE conversation_id = ANY(${convIds}::uuid[])
      ORDER BY conversation_id, "timestamp" DESC
    `;
    console.log("rows:", rows.length);
    rows.forEach((r) => console.log(" ", r));
  } catch (e) {
    console.error("ERR:", e);
  }
  await sql.end();
}
main();
