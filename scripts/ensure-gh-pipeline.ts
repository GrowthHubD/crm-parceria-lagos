import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { pipeline, pipelineStage } from "../src/lib/db/schema/pipeline";

const GH = "00000000-0000-0000-0000-000000000001";
const STAGES = [
  { name: "Novo", order: 0, color: "#6B7280", isWon: false },
  { name: "Em contato", order: 1, color: "#3B82F6", isWon: false },
  { name: "Negociação", order: 2, color: "#F59E0B", isWon: false },
  { name: "Ganho", order: 3, color: "#10B981", isWon: true },
  { name: "Perdido", order: 4, color: "#EF4444", isWon: false },
];

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const db = drizzle(sql);

  const existingStages = await db.select().from(pipelineStage).where(eq(pipelineStage.tenantId, GH));
  console.log(`→ ${existingStages.length} stages existentes no GH`);

  if (existingStages.length > 0) {
    console.log("  (já tem stages, nada a fazer)");
    await sql.end();
    return;
  }

  const existingPipes = await db.select().from(pipeline).where(eq(pipeline.tenantId, GH));
  let pipeId: string;
  if (existingPipes.length > 0) {
    pipeId = existingPipes[0].id;
    console.log(`→ reusando pipeline existente ${pipeId.slice(-6)}`);
  } else {
    const [p] = await db.insert(pipeline).values({
      tenantId: GH,
      name: "Funil principal",
      description: "Criado pelo setup inicial",
      isDefault: true,
    }).returning({ id: pipeline.id });
    pipeId = p.id;
    console.log(`→ pipeline criado ${pipeId.slice(-6)}`);
  }

  await db.insert(pipelineStage).values(
    STAGES.map((s) => ({
      tenantId: GH,
      pipelineId: pipeId,
      name: s.name,
      order: s.order,
      color: s.color,
      isWon: s.isWon,
    }))
  );
  console.log(`✓ ${STAGES.length} stages criadas`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
