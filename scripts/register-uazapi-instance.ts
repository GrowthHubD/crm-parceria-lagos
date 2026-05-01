/**
 * Registra uma instância Uazapi EXISTENTE no banco como whatsapp_number
 * do tenant GH. Não cria nada na Uazapi — só vincula o que já existe.
 *
 * Uso: npx tsx scripts/register-uazapi-instance.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

const GH = "00000000-0000-0000-0000-000000000001";

// Dados da instância existente (vindos do painel Uazapi)
const INSTANCE = {
  name: "horizoniabotsmorolanumber",
  token: "e88c26aa-583f-4402-a2e9-7e612613af53",
  phone: "5521999433160",
  serverUrl: "https://williphone.uazapi.com",
};

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  // Desativa quaisquer outras whatsapp_number ativas pra evitar ambiguidade
  // (runner pega a primeira ativa).
  const deactivated = await sql<{ id: string; label: string }[]>`
    UPDATE public.whatsapp_number
    SET is_active = false
    WHERE tenant_id = ${GH} AND is_active = true
    RETURNING id, label
  `;
  if (deactivated.length > 0) {
    console.log(`Desativadas ${deactivated.length} outra(s) wn:`);
    deactivated.forEach((d) => console.log(`  • ${d.label}`));
  }

  // Verifica se já existe entry com esse phone
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM public.whatsapp_number
    WHERE phone_number = ${INSTANCE.phone}
  `;

  if (existing.length > 0) {
    await sql`
      UPDATE public.whatsapp_number
      SET tenant_id = ${GH},
          label = ${"Uazapi prod"},
          uazapi_session = ${INSTANCE.name},
          uazapi_token = ${INSTANCE.token},
          is_active = true
      WHERE id = ${existing[0].id}
    `;
    console.log(`✓ Atualizado wn existente ${existing[0].id}`);
  } else {
    const [created] = await sql<{ id: string }[]>`
      INSERT INTO public.whatsapp_number
        (tenant_id, label, phone_number, uazapi_session, uazapi_token, is_active)
      VALUES
        (${GH}, ${"Uazapi prod"}, ${INSTANCE.phone}, ${INSTANCE.name}, ${INSTANCE.token}, true)
      RETURNING id
    `;
    console.log(`✓ wn criado ${created.id}`);
  }

  // Verifica estado final
  const final = await sql<{ label: string; phone_number: string; uazapi_session: string; is_active: boolean }[]>`
    SELECT label, phone_number, uazapi_session, is_active
    FROM public.whatsapp_number
    WHERE tenant_id = ${GH}
    ORDER BY is_active DESC
  `;
  console.log("\nEstado final:");
  final.forEach((w) =>
    console.log(`  ${w.is_active ? "✓" : "✗"} ${w.label} | session=${w.uazapi_session} | ${w.phone_number}`)
  );

  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
