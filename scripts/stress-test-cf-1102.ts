/**
 * Diagnóstico do erro intermitente "ERROR 2000190099" / CF 1102 em produção.
 *
 * Roda: `npx tsx scripts/stress-test-cf-1102.ts`
 *
 * Estratégia:
 * 1. Bate em cada rota N vezes em série, espaçando 200ms (simula cliques de user)
 * 2. Captura: status, latência, tamanho do body, e SE for erro CF, qual o code
 * 3. Roda também uma rajada paralela (10 concurrent) pra forçar cold-start
 *    em isolates diferentes
 * 4. Cruza com `/api/tenant/context` (rápido, KV-only) pra isolar se o
 *    problema é no SSR pesado vs em qualquer route handler
 */

const BASE = "https://crm.methodgrowthhub.com.br";

const ROUTES = [
  "/",
  "/clientes",
  "/contratos",
  "/tasks",
  "/crm",
  "/pipeline",
  "/automations",
  "/api/tenant/context",
  "/api/crm",
];

interface Sample {
  route: string;
  status: number;
  ms: number;
  bodySize: number;
  cfError?: number; // 1101, 1102 etc se body começar com "error code: NNNN"
  fingerprint: string; // primeiros 60 chars do body, pra detectar variação
}

async function hit(route: string): Promise<Sample> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${route}`, {
      redirect: "manual", // não segue 302 pra /login (queremos ver o status original)
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    const cfMatch = /error code:\s*(\d+)/i.exec(text);
    return {
      route,
      status: res.status,
      ms,
      bodySize: text.length,
      cfError: cfMatch ? Number(cfMatch[1]) : undefined,
      fingerprint: text.slice(0, 60).replace(/\s+/g, " "),
    };
  } catch (e) {
    return {
      route,
      status: 0,
      ms: Date.now() - t0,
      bodySize: 0,
      fingerprint: `FETCH_ERROR: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function pct(samples: Sample[], p: number): number {
  const sorted = [...samples].sort((a, b) => a.ms - b.ms);
  return sorted[Math.floor(sorted.length * p)]?.ms ?? 0;
}

async function serial(rounds: number) {
  console.log(`\n── Serial test: ${rounds} rounds × ${ROUTES.length} routes (200ms gap) ──`);
  const all: Sample[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const route of ROUTES) {
      const s = await hit(route);
      all.push(s);
      const flag = s.cfError ? `🔴 CF-${s.cfError}` : s.status >= 500 ? "🔴 5xx" : s.status >= 400 ? "🟡" : "🟢";
      console.log(`${flag} [r${r}] ${route.padEnd(25)} ${s.status} ${s.ms.toString().padStart(5)}ms  ${s.fingerprint.slice(0, 40)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return all;
}

async function burst(concurrent: number) {
  console.log(`\n── Burst test: ${concurrent} concurrent × ${ROUTES.length} routes (force cold-start) ──`);
  const all: Sample[] = [];
  for (const route of ROUTES) {
    const samples = await Promise.all(Array.from({ length: concurrent }, () => hit(route)));
    all.push(...samples);
    const fail = samples.filter((s) => s.cfError || s.status >= 500).length;
    const okCount = samples.length - fail;
    const p50 = pct(samples, 0.5);
    const p95 = pct(samples, 0.95);
    console.log(
      `${fail === 0 ? "🟢" : "🔴"} ${route.padEnd(25)} ok=${okCount}/${samples.length} fail=${fail} p50=${p50}ms p95=${p95}ms`
    );
  }
  return all;
}

function summary(samples: Sample[]) {
  console.log("\n── Summary by route ──");
  const byRoute = new Map<string, Sample[]>();
  for (const s of samples) {
    const arr = byRoute.get(s.route) ?? [];
    arr.push(s);
    byRoute.set(s.route, arr);
  }
  for (const [route, arr] of byRoute) {
    const fail = arr.filter((s) => s.cfError || s.status >= 500);
    const cfCodes = [...new Set(fail.map((f) => f.cfError).filter(Boolean))];
    const failRate = ((fail.length / arr.length) * 100).toFixed(1);
    const p50 = pct(arr, 0.5);
    const p95 = pct(arr, 0.95);
    const p99 = pct(arr, 0.99);
    console.log(
      `  ${route.padEnd(25)}  failRate=${failRate}%  p50=${p50}ms p95=${p95}ms p99=${p99}ms  cfCodes=[${cfCodes.join(",")}]`
    );
  }
}

async function main() {
  console.log(`Stress test against ${BASE}`);
  console.log(`Started at ${new Date().toISOString()}\n`);

  const serialResults = await serial(3);
  const burstResults = await burst(8);

  summary([...serialResults, ...burstResults]);

  // Highlight
  const all = [...serialResults, ...burstResults];
  const cf1102 = all.filter((s) => s.cfError === 1102);
  const cf1101 = all.filter((s) => s.cfError === 1101);
  const otherCf = all.filter((s) => s.cfError && s.cfError !== 1101 && s.cfError !== 1102);
  const fetchErrs = all.filter((s) => s.status === 0);

  console.log(`\n── Failure breakdown (total ${all.length} samples) ──`);
  console.log(`  CF 1102 (CPU exceeded):           ${cf1102.length}`);
  console.log(`  CF 1101 (worker threw):           ${cf1101.length}`);
  console.log(`  CF other:                         ${otherCf.length}  (${[...new Set(otherCf.map((s) => s.cfError))].join(",")})`);
  console.log(`  Fetch errors (network/abort):     ${fetchErrs.length}`);

  if (cf1102.length > 0) {
    const byRoute = new Map<string, number>();
    for (const s of cf1102) byRoute.set(s.route, (byRoute.get(s.route) ?? 0) + 1);
    console.log(`\n  1102 by route: ${[...byRoute.entries()].map(([r, n]) => `${r}=${n}`).join(", ")}`);
    console.log(`\n  → 1102 = CF Worker excedeu CPU. Possíveis causas:`);
    console.log(`     1. Cold-start parsing de bundle 10MB do OpenNext`);
    console.log(`     2. Smart Placement enviando isolates pra regiões frias`);
    console.log(`     3. Loop/work pesado num server component (raro se outcome=ok no tail)`);
    console.log(`\n  → Mitigations:`);
    console.log(`     a) Desabilitar Smart Placement: 'mode = "off"' no [placement] do wrangler.toml`);
    console.log(`        (mantém isolates concentrados, mais reuso, menos cold-starts)`);
    console.log(`     b) Cron warmer: cron job externo pingando o domínio a cada 60s`);
    console.log(`     c) Reduzir bundle: lazy import de schemas pesados, drizzle, etc`);
  }
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
