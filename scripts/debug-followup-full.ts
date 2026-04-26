import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  console.log("\n═══ AUTOMATIONS lead_inactive ═══");
  const autos = await sql`
    SELECT id, name, trigger_type, trigger_config, is_active
    FROM public.automation
    WHERE trigger_type = 'lead_inactive';
  `;
  autos.forEach((a) => console.log(`  • ${a.name} active=${a.is_active} config=${JSON.stringify(a.trigger_config)}`));

  console.log("\n═══ LEADS + CONVERSATION STATE ═══");
  const leads = await sql`
    SELECT
      l.id AS lead_id, l.name, l.phone, l.crm_conversation_id,
      c.id AS conv_id, c.is_group,
      c.last_outgoing_at, c.last_incoming_at,
      c.last_message_at
    FROM public.lead l
    LEFT JOIN public.crm_conversation c ON c.id = l.crm_conversation_id
    WHERE l.tenant_id = '00000000-0000-0000-0000-000000000001'
    ORDER BY l.created_at DESC;
  `;
  const now = Date.now();
  leads.forEach((l) => {
    console.log(`\n  • ${l.name} (${l.phone})`);
    console.log(`    lead.crm_conversation_id = ${l.crm_conversation_id ?? "NULL"}`);
    if (!l.conv_id) {
      console.log(`    ⚠ Sem conversation linkada!`);
      return;
    }
    console.log(`    conv is_group = ${l.is_group}`);
    const outAt = l.last_outgoing_at ? new Date(l.last_outgoing_at as Date) : null;
    const inAt = l.last_incoming_at ? new Date(l.last_incoming_at as Date) : null;
    console.log(`    last_outgoing_at = ${outAt?.toISOString() ?? "NULL"} (${outAt ? `${Math.round((now - outAt.getTime())/1000)}s atrás` : "-"})`);
    console.log(`    last_incoming_at = ${inAt?.toISOString() ?? "NULL"} (${inAt ? `${Math.round((now - inAt.getTime())/1000)}s atrás` : "-"})`);

    // Avaliar critérios
    const checks: string[] = [];
    if (l.is_group) checks.push("❌ é grupo");
    if (!outAt) checks.push("❌ nunca respondeu (last_outgoing_at NULL)");
    if (outAt && inAt && inAt > outAt) checks.push("❌ last_incoming > last_outgoing (lead já respondeu)");
    if (outAt && !checks.length) {
      for (const a of autos) {
        const cfg = a.trigger_config as { inactiveMinutes?: number; inactiveHours?: number; inactiveDays?: number };
        const totalMs = (cfg?.inactiveDays ?? 0) * 86400000 + (cfg?.inactiveHours ?? 0) * 3600000 + (cfg?.inactiveMinutes ?? 0) * 60000;
        const threshold = totalMs || 3 * 86400000;
        const age = now - outAt.getTime();
        const eligible = age >= threshold;
        checks.push(`${eligible ? "✓" : "❌"} autom "${a.name}": age=${Math.round(age/1000)}s threshold=${Math.round(threshold/1000)}s`);
      }
    }
    checks.forEach((c) => console.log(`    ${c}`));
  });

  console.log("\n═══ LOGS recentes de follow-ups ═══");
  const logs = await sql`
    SELECT al.id, a.name as auto_name, al.lead_id, al.status, al.scheduled_at, al.executed_at, al.error
    FROM public.automation_log al
    JOIN public.automation a ON a.id = al.automation_id
    WHERE a.trigger_type = 'lead_inactive'
    ORDER BY al.created_at DESC LIMIT 10;
  `;
  logs.forEach((l) => console.log(`  • ${l.auto_name} lead=${String(l.lead_id).slice(-6)} status=${l.status} err=${l.error ?? "-"}`));

  await sql.end();
}
main().catch(console.error);
