import "dotenv/config";
import postgres from "postgres";

const SQL = `
-- SaaS 3-níveis: partner_id aponta pro tenant do parceiro que criou este cliente
ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.tenant(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_partner BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'pro',
  ADD COLUMN IF NOT EXISTS billing_email TEXT,
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS max_whatsapp_numbers INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_operators INTEGER NOT NULL DEFAULT 3;

-- Índice pra buscar clientes de um parceiro rápido
CREATE INDEX IF NOT EXISTS idx_tenant_partner_id ON public.tenant(partner_id);
`;

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });

  console.log("→ Aplicando ALTER TABLE tenant...");
  await sql.unsafe(SQL);
  console.log("✓ Colunas adicionadas");

  const cols = await sql`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'tenant' AND table_schema = 'public'
    ORDER BY ordinal_position;
  `;
  console.log(`\n✓ ${cols.length} colunas em tenant:\n`);
  cols.forEach((c) => console.log(`  • ${c.column_name} (${c.data_type})${c.column_default ? ` = ${c.column_default}` : ""}`));

  await sql.end();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
