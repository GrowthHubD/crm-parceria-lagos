import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Busca mídia com .bin (fallback ruim)
  const bad = await sql`
    SELECT id, media_url FROM public.crm_message
    WHERE media_type IN ('audio','image','video') AND media_url LIKE '%.bin';
  `;
  console.log(`→ ${bad.length} mídias ruins (.bin) no DB`);

  for (const row of bad) {
    const url = row.media_url as string;
    const pathMatch = url.match(/\/storage\/v1\/object\/public\/whatsapp-media\/(.+)$/);
    if (pathMatch) {
      const path = pathMatch[1];
      await supa.storage.from("whatsapp-media").remove([path]);
      console.log(`  ✓ removido do Storage: ${path.slice(0, 60)}`);
    }
    await sql`UPDATE public.crm_message SET media_url = NULL WHERE id = ${row.id as string};`;
  }

  console.log(`\n✅ ${bad.length} mídias limpas. Quando a conversa receber mídia nova, o fallback correto vai rodar.`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
