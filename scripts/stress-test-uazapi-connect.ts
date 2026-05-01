/**
 * Stress test do fluxo de conexão Uazapi.
 *
 * Exercita /instance/init + /instance/connect (QR) + /instance/status + cleanup
 * repetidas vezes pra detectar:
 *  - Falhas intermitentes (rate limit, timeout, race)
 *  - Resposta inconsistente (token não vem, status errado)
 *  - Acúmulo de instâncias órfãs
 *
 * Uso: npx tsx scripts/stress-test-uazapi-connect.ts [num_iterations]
 */

import "dotenv/config";

const BASE = (process.env.UAZAPI_BASE_URL ?? "https://api.uazapi.com").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN ?? process.env.UAZAPI_TOKEN ?? "";
const ITERATIONS = Number(process.argv[2] ?? 20);

if (!ADMIN_TOKEN) {
  console.error("✗ UAZAPI_ADMIN_TOKEN não definido em .env.local");
  process.exit(1);
}

interface TestResult {
  iteration: number;
  step: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  data?: unknown;
}

const results: TestResult[] = [];

async function callApi<T>(
  path: string,
  init: RequestInit,
  token: string,
  useAdmin: boolean
): Promise<{ ok: boolean; status: number; body: T | null; error?: string; durationMs: number }> {
  const start = Date.now();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (useAdmin) headers.admintoken = token;
    else headers.token = token;

    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    const durationMs = Date.now() - start;

    let body: T | null = null;
    try { body = JSON.parse(text) as T; } catch { /* not json */ }

    if (!res.ok) {
      return { ok: false, status: res.status, body, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, durationMs };
    }
    return { ok: true, status: res.status, body, durationMs };
  } catch (e) {
    const durationMs = Date.now() - start;
    return { ok: false, status: 0, body: null, error: e instanceof Error ? e.message : String(e), durationMs };
  }
}

async function runIteration(iter: number): Promise<{ instanceId: string | null; instanceToken: string | null }> {
  const instanceId = `stress-test-${iter}-${Date.now()}`;
  let instanceToken: string | null = null;

  // ── 1) /instance/init (admin) — cria instância
  console.log(`\n[${iter}/${ITERATIONS}] → /instance/init "${instanceId}"`);
  const init = await callApi<{ instance?: { token?: string; id?: string; status?: string } }>(
    "/instance/init",
    { method: "POST", body: JSON.stringify({ name: instanceId }) },
    ADMIN_TOKEN,
    true
  );
  results.push({ iteration: iter, step: "init", ok: init.ok, durationMs: init.durationMs, error: init.error, data: init.body });

  if (!init.ok || !init.body) {
    console.log(`  ✗ init falhou em ${init.durationMs}ms: ${init.error}`);
    return { instanceId, instanceToken };
  }
  instanceToken = init.body.instance?.token ?? null;
  console.log(`  ✓ init ok em ${init.durationMs}ms — token: ${instanceToken?.slice(0, 8)}...`);

  if (!instanceToken) {
    console.log(`  ⚠ init NÃO retornou token! body:`, JSON.stringify(init.body).slice(0, 300));
    return { instanceId, instanceToken };
  }

  // ── 2) /webhook/set — configura webhook
  const webhookUrl = "https://crm.methodgrowthhub.com.br/api/webhooks/uazapi/v2";
  const wh = await callApi<unknown>(
    "/webhook",
    { method: "POST", body: JSON.stringify({ url: webhookUrl, events: ["messages", "messages_update", "connection"] }) },
    instanceToken,
    false
  );
  results.push({ iteration: iter, step: "webhook", ok: wh.ok, durationMs: wh.durationMs, error: wh.error });
  console.log(`  ${wh.ok ? "✓" : "✗"} webhook em ${wh.durationMs}ms ${wh.error ?? ""}`);

  // ── 3) /instance/connect — pede QR code
  const qr = await callApi<{ connected?: boolean; instance?: { qrcode?: string; status?: string } }>(
    "/instance/connect",
    { method: "POST", body: JSON.stringify({ name: instanceId }) },
    instanceToken,
    false
  );
  results.push({ iteration: iter, step: "qr", ok: qr.ok, durationMs: qr.durationMs, error: qr.error });

  if (!qr.ok) {
    console.log(`  ✗ QR falhou em ${qr.durationMs}ms: ${qr.error}`);
    return { instanceId, instanceToken };
  }
  const hasQr = Boolean(qr.body?.instance?.qrcode);
  console.log(`  ✓ QR em ${qr.durationMs}ms — qrcode: ${hasQr ? "presente" : "AUSENTE"} — status: ${qr.body?.instance?.status}`);

  // ── 4) /instance/status — verifica estado
  const st = await callApi<{ status?: string; connected?: boolean }>(
    "/instance/status",
    { method: "GET" },
    instanceToken,
    false
  );
  results.push({ iteration: iter, step: "status", ok: st.ok, durationMs: st.durationMs, error: st.error });
  console.log(`  ${st.ok ? "✓" : "✗"} status em ${st.durationMs}ms — ${st.body?.status ?? st.error}`);

  return { instanceId, instanceToken };
}

async function cleanup(instances: { instanceId: string; instanceToken: string | null }[]) {
  console.log(`\n→ Limpando ${instances.length} instâncias de teste...`);
  for (const inst of instances) {
    if (!inst.instanceToken) continue;
    try {
      await callApi<unknown>(
        "/instance/logout",
        { method: "POST", body: JSON.stringify({ name: inst.instanceId }) },
        inst.instanceToken,
        false
      );
    } catch { /* best-effort */ }
    try {
      await callApi<unknown>(
        `/instance/delete?name=${encodeURIComponent(inst.instanceId)}`,
        { method: "DELETE" },
        ADMIN_TOKEN,
        true
      );
    } catch { /* best-effort */ }
  }
  console.log(`✓ Cleanup ok`);
}

async function main() {
  console.log(`\n=== STRESS TEST UAZAPI — ${ITERATIONS} iterações ===`);
  console.log(`Base: ${BASE}`);
  console.log(`Admin token: ${ADMIN_TOKEN.slice(0, 8)}...\n`);

  const created: { instanceId: string; instanceToken: string | null }[] = [];

  for (let i = 1; i <= ITERATIONS; i++) {
    const { instanceId, instanceToken } = await runIteration(i);
    if (instanceId) created.push({ instanceId, instanceToken });
    // Pequeno delay pra não bater rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  // ── Sumário ──────────────────────────────────────────────────────────
  console.log(`\n\n========== SUMÁRIO ==========\n`);

  const bySte = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!bySte.has(r.step)) bySte.set(r.step, []);
    bySte.get(r.step)!.push(r);
  }

  for (const [step, rs] of bySte) {
    const ok = rs.filter((r) => r.ok).length;
    const fail = rs.length - ok;
    const avg = Math.round(rs.reduce((s, r) => s + r.durationMs, 0) / rs.length);
    const max = Math.max(...rs.map((r) => r.durationMs));
    const min = Math.min(...rs.map((r) => r.durationMs));
    console.log(`${step.padEnd(10)} — ok: ${ok}/${rs.length} | avg: ${avg}ms | min: ${min}ms | max: ${max}ms${fail > 0 ? ` | ⚠ ${fail} FALHAS` : ""}`);
  }

  // Falhas detalhadas
  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.log(`\n⚠ FALHAS DETALHADAS (${failures.length}):`);
    for (const f of failures) {
      console.log(`  iter=${f.iteration} step=${f.step} ms=${f.durationMs} err=${f.error?.slice(0, 200)}`);
    }
  }

  // Inconsistências (init sem token, QR sem qrcode etc.)
  console.log(`\n→ Verificando inconsistências...`);
  const initNoToken = results
    .filter((r) => r.step === "init" && r.ok)
    .filter((r) => !(r.data as { instance?: { token?: string } } | null)?.instance?.token);
  if (initNoToken.length > 0) {
    console.log(`⚠ ${initNoToken.length} init's retornaram OK mas SEM token — bug no parser!`);
  } else {
    console.log(`✓ Todos os init's retornaram token`);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────
  await cleanup(created);
}

main().catch((e) => {
  console.error("\n✗ Fatal:", e);
  process.exit(1);
});
