/**
 * Testa conectividade com Evolution API (dev).
 * Lista instâncias existentes + cria uma de teste + deleta.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

async function main() {
  const BASE = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const KEY = process.env.EVOLUTION_API_KEY;

  if (!BASE || !KEY) {
    console.error("❌ EVOLUTION_API_URL ou EVOLUTION_API_KEY não definidas");
    process.exit(1);
  }

  console.log(`→ Base URL: ${BASE}`);
  console.log(`→ API Key: ${KEY.slice(0, 8)}...${KEY.slice(-4)}\n`);

  // 1) Tenta listar instâncias existentes
  console.log("→ GET /instance/fetchInstances");
  const listRes = await fetch(`${BASE}/instance/fetchInstances`, {
    headers: { apikey: KEY, "Content-Type": "application/json" },
  });
  const listText = await listRes.text();
  if (!listRes.ok) {
    console.error(`  ✗ ${listRes.status}: ${listText.slice(0, 200)}`);
    process.exit(1);
  }

  let instances: Array<{ name?: string; connectionStatus?: string; number?: string }> = [];
  try {
    instances = JSON.parse(listText);
  } catch {
    console.error(`  ✗ resposta não é JSON: ${listText.slice(0, 200)}`);
    process.exit(1);
  }

  console.log(`  ✓ API respondeu (HTTP ${listRes.status})`);
  console.log(`  ✓ ${instances.length} instâncias existentes:\n`);

  if (instances.length === 0) {
    console.log("    (nenhuma)");
  } else {
    instances.forEach((i) => {
      const status = i.connectionStatus === "open"
        ? "🟢 conectada"
        : i.connectionStatus === "connecting"
        ? "🟡 conectando"
        : "🔴 desconectada";
      console.log(`    • ${i.name}: ${status}${i.number ? ` (${i.number})` : ""}`);
    });
  }

  console.log("\n✅ Evolution API tá respondendo.");
  console.log("\nPróximos passos pra testar no app:");
  console.log("  1. http://localhost:3000/login → entra com method.growth.hub@gmail.com");
  console.log("  2. http://localhost:3000/partner → criar um cliente de teste");
  console.log("  3. Na lista, clica 'Conectar WhatsApp' no card → abre modal com QR");
  console.log("  4. Escaneia com um WhatsApp no celular");
  console.log("  5. Pronto — mensagens enviadas pro número aparecem no CRM\n");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
