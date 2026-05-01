/**
 * Deleta um tenant de teste (e seu user admin) — limpa lixo de validações.
 * Uso: npx tsx scripts/delete-test-tenant.ts <tenantId> [userId]
 *
 * Operação cascata via FKs do schema:
 * - tenant → cascade pra whatsapp_number, pipeline, pipeline_stage, lead, etc.
 * - user (Supabase Auth) → deletado via supabase admin API.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const TID = process.argv[2];
const UID = process.argv[3];
if (!TID) { console.error("Usage: tsx scripts/delete-test-tenant.ts <tenantId> [userId]"); process.exit(1); }

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  // Busca whatsapp_number pra remover instância na Uazapi também.
  // Endpoint correto da Uazapi v2: DELETE /instance com header `token`
  // (token DA INSTÂNCIA, não admintoken).
  const wRows = await sql`SELECT id, uazapi_session, uazapi_token FROM whatsapp_number WHERE tenant_id = ${TID};`;
  for (const w of wRows) {
    if (w.uazapi_session && w.uazapi_token && w.uazapi_token !== "" && w.uazapi_session !== "baileys") {
      try {
        const r = await fetch(`${process.env.UAZAPI_BASE_URL}/instance`, {
          method: "DELETE",
          headers: { token: w.uazapi_token },
        });
        console.log(`Uazapi delete ${w.uazapi_session}: HTTP ${r.status}`);
      } catch (e) {
        console.warn("Uazapi delete failed:", e);
      }
    }
  }

  console.log(`→ Deletando dependências do tenant ${TID}...`);
  // Algumas FKs são RESTRICT — apaga manualmente em ordem reversa.
  await sql`DELETE FROM crm_message WHERE conversation_id IN (SELECT id FROM crm_conversation WHERE tenant_id = ${TID});`;
  await sql`DELETE FROM crm_conversation WHERE tenant_id = ${TID};`;
  await sql`DELETE FROM whatsapp_number WHERE tenant_id = ${TID};`;
  await sql`DELETE FROM lead WHERE tenant_id = ${TID};`;
  await sql`DELETE FROM pipeline_stage WHERE tenant_id = ${TID};`;
  await sql`DELETE FROM pipeline WHERE tenant_id = ${TID};`;
  await sql`DELETE FROM user_tenant WHERE tenant_id = ${TID};`;
  await sql`DELETE FROM tenant WHERE id = ${TID};`;
  console.log("  ✓ Tenant + relacionados");

  if (UID) {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { error } = await supa.auth.admin.deleteUser(UID);
    if (error) console.warn("Supabase user delete error:", error.message);
    else console.log("  ✓ User deletado em auth.users");

    await sql`DELETE FROM public."user" WHERE id = ${UID};`;
    console.log("  ✓ User espelho deletado em public.user");
  }

  await sql.end();
  console.log("\n✅ Cleanup concluído.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
