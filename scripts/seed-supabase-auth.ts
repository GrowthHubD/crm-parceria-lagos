/**
 * Cria o user inicial no Supabase Auth e espelha em public.user.
 *
 * Idempotente: se user já existe, só re-vincula.
 *
 * Run: npx tsx scripts/seed-supabase-auth.ts
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const GH_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ALEXANDRE_TENANT_ID = "00000000-0000-0000-0000-000000000002";

const INITIAL_USERS = [
  {
    email: "method.growth.hub@gmail.com",
    password: "MudeEssaSenha123!",
    name: "Growth Hub Admin",
    role: "partner" as const,
    tenants: [
      { tenantId: GH_TENANT_ID, role: "superadmin", isDefault: true },
      { tenantId: ALEXANDRE_TENANT_ID, role: "partner_admin", isDefault: false },
    ],
  },
];

async function main() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supaUrl || !serviceKey) {
    console.error("❌ Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const admin = createClient(supaUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
  });

  for (const u of INITIAL_USERS) {
    console.log(`\n→ Processando ${u.email}...`);

    // Busca user existente por email (SupabaseAdmin.listUsers tem filtros limitados, usamos getUserByEmail via SQL)
    const existingRows = await sql`
      SELECT id FROM auth.users WHERE email = ${u.email} LIMIT 1;
    `;
    let userId: string;

    if (existingRows[0]?.id) {
      userId = existingRows[0].id as string;
      console.log(`  ✓ Já existe em auth.users: ${userId}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { name: u.name },
      });
      if (error || !data.user) {
        console.error(`  ✗ Falhou: ${error?.message}`);
        continue;
      }
      userId = data.user.id;
      console.log(`  ✓ Criado em auth.users: ${userId}`);
    }

    // Espelha em public.user (FK em auth.users.id)
    await sql`
      INSERT INTO public.user (id, name, email, "emailVerified", role, "isActive", "createdAt", "updatedAt")
      VALUES (${userId}, ${u.name}, ${u.email}, true, ${u.role}, true, now(), now())
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            role = EXCLUDED.role,
            "updatedAt" = now();
    `;
    console.log(`  ✓ Espelhado em public.user`);

    // Vincula aos tenants
    for (const t of u.tenants) {
      await sql`
        INSERT INTO public.user_tenant (user_id, tenant_id, role, is_default)
        VALUES (${userId}, ${t.tenantId}, ${t.role}, ${t.isDefault})
        ON CONFLICT (user_id, tenant_id) DO UPDATE
          SET role = EXCLUDED.role,
              is_default = EXCLUDED.is_default;
      `;
      console.log(`  ✓ Vinculado ao tenant ${t.tenantId.slice(-4)} como ${t.role}`);
    }
  }

  await sql.end();
  console.log("\n✅ Seed Supabase Auth completo.");
  console.log("\nLogin em http://localhost:3000/login:");
  for (const u of INITIAL_USERS) {
    console.log(`  ${u.email} / ${u.password}`);
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
