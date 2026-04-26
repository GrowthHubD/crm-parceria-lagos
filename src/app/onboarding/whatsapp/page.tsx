import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTenantContext } from "@/lib/tenant";
import { db } from "@/lib/db";
import { whatsappNumber } from "@/lib/db/schema/crm";
import { eq } from "drizzle-orm";
import { OnboardingWhatsappClient } from "@/components/onboarding/whatsapp-client";

export const metadata: Metadata = { title: "Conectar WhatsApp" };

export default async function OnboardingWhatsappPage() {
  let ctx;
  try {
    ctx = await getTenantContext(await headers());
  } catch {
    redirect("/login");
  }

  const [wnum] = await db
    .select({
      id: whatsappNumber.id,
      phoneNumber: whatsappNumber.phoneNumber,
      isActive: whatsappNumber.isActive,
    })
    .from(whatsappNumber)
    .where(eq(whatsappNumber.tenantId, ctx.tenantId))
    .limit(1);

  // Se já está conectado, vai direto pro dashboard
  if (wnum?.isActive && !wnum.phoneNumber.startsWith("pending-")) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <OnboardingWhatsappClient tenantId={ctx.tenantId} />
    </div>
  );
}
