/**
 * Seed inicial — cria a estrutura mínima pra dev/testes:
 *
 * 1. Tenant GH (is_platform_owner = true) com UUID fixo
 * 2. Tenant Alexandre (is_partner = true)
 * 3. User "Dev User" linked a:
 *    - GH como superadmin (isDefault = true)
 *    - Alexandre como partner_admin (pra testar trocar de tenant)
 *
 * Idempotente: pode rodar várias vezes sem duplicar.
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { tenant } from "../src/lib/db/schema/tenants";
import { user, userTenant } from "../src/lib/db/schema/users";

const GH_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ALEXANDRE_TENANT_ID = "00000000-0000-0000-0000-000000000002";
const DEV_USER_ID = "dev-user-id"; // match com tenant.ts mock

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
  });
  const db = drizzle(sql);

  // 1) Tenant GH
  const [ghExisting] = await db
    .select({ id: tenant.id })
    .from(tenant)
    .where(eq(tenant.id, GH_TENANT_ID))
    .limit(1);

  if (!ghExisting) {
    await db.insert(tenant).values({
      id: GH_TENANT_ID,
      name: "Growth Hub",
      slug: "gh",
      isPlatformOwner: true,
      isPartner: false,
      plan: "enterprise",
      billingStatus: "active",
      status: "active",
    });
    console.log("✓ Tenant GH criado");
  } else {
    console.log("→ Tenant GH já existe");
  }

  // 2) Tenant Alexandre (parceiro revendedor)
  const [alexExisting] = await db
    .select({ id: tenant.id })
    .from(tenant)
    .where(eq(tenant.id, ALEXANDRE_TENANT_ID))
    .limit(1);

  if (!alexExisting) {
    await db.insert(tenant).values({
      id: ALEXANDRE_TENANT_ID,
      name: "Alexandre — Lagos Assessoria",
      slug: "alexandre",
      isPlatformOwner: false,
      isPartner: true,
      plan: "enterprise",
      billingEmail: "alexandre@lagos.com.br",
      billingStatus: "active",
      status: "active",
    });
    console.log("✓ Tenant Alexandre (parceiro) criado");
  } else {
    console.log("→ Tenant Alexandre já existe");
  }

  // 3) Dev user
  const [devUserExisting] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, DEV_USER_ID))
    .limit(1);

  if (!devUserExisting) {
    await db.insert(user).values({
      id: DEV_USER_ID,
      name: "Dev User",
      email: "dev@localhost",
      emailVerified: true,
      role: "partner",
      isActive: true,
    });
    console.log("✓ Dev user criado");
  } else {
    console.log("→ Dev user já existe");
  }

  // 4) user_tenant: dev → GH (superadmin, default)
  const [ut1] = await db
    .select({ id: userTenant.id })
    .from(userTenant)
    .where(eq(userTenant.userId, DEV_USER_ID))
    .limit(1);

  if (!ut1) {
    await db.insert(userTenant).values([
      {
        userId: DEV_USER_ID,
        tenantId: GH_TENANT_ID,
        role: "superadmin",
        isDefault: true,
      },
      {
        userId: DEV_USER_ID,
        tenantId: ALEXANDRE_TENANT_ID,
        role: "partner_admin",
        isDefault: false,
      },
    ]);
    console.log("✓ user_tenant: dev → GH (superadmin) + Alexandre (partner_admin)");
  } else {
    console.log("→ user_tenant já existe");
  }

  await sql.end();
  console.log("\n✅ Seed inicial concluído");
  console.log(`   GH tenant id:        ${GH_TENANT_ID}`);
  console.log(`   Alexandre tenant id: ${ALEXANDRE_TENANT_ID}`);
  console.log(`   Dev user id:         ${DEV_USER_ID}`);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
