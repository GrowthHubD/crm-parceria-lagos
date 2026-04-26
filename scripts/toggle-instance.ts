/**
 * Liga/desliga whatsapp_number.is_active.
 * Uso: npx tsx scripts/toggle-instance.ts off
 *      npx tsx scripts/toggle-instance.ts on
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const action = process.argv[2];
  if (action !== "on" && action !== "off") {
    console.error("Uso: npx tsx scripts/toggle-instance.ts [on|off]");
    process.exit(1);
  }

  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  const before = await sql<{ id: string; label: string; phone_number: string; is_active: boolean }[]>`
    SELECT id, label, phone_number, is_active FROM public.whatsapp_number
  `;
  console.log("Antes:");
  before.forEach((w) => console.log(`  ${w.label} | ${w.phone_number} | active=${w.is_active}`));

  const newState = action === "on";
  const updated = await sql<{ id: string; label: string }[]>`
    UPDATE public.whatsapp_number SET is_active = ${newState} RETURNING id, label
  `;
  console.log(`\n✓ ${updated.length} instância(s) agora com active=${newState}`);
  updated.forEach((w) => console.log(`  ${w.label}`));

  await sql.end();
}
main().catch(console.error);
