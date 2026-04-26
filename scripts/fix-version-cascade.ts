import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });

  // Descobre todas FKs em step_id
  const fks = await sql`
    SELECT tc.constraint_name, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'automation_step_version' AND tc.constraint_type = 'FOREIGN KEY';
  `;
  console.log("FKs atuais:", fks);

  for (const f of fks) {
    if (String(f.constraint_name).includes("step_id")) {
      console.log(`→ Dropping ${f.constraint_name} (rule: ${f.delete_rule})`);
      await sql.unsafe(`ALTER TABLE public.automation_step_version DROP CONSTRAINT ${f.constraint_name}`);
    }
  }

  console.log("→ Recriando FK com ON DELETE SET NULL...");
  await sql.unsafe(`
    ALTER TABLE public.automation_step_version
      ALTER COLUMN step_id DROP NOT NULL;
    ALTER TABLE public.automation_step_version
      ADD CONSTRAINT automation_step_version_step_id_set_null
      FOREIGN KEY (step_id) REFERENCES public.automation_step(id) ON DELETE SET NULL;
  `);

  const newFks = await sql`
    SELECT tc.constraint_name, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'automation_step_version' AND tc.constraint_type = 'FOREIGN KEY';
  `;
  console.log("✓ FKs atualizadas:", newFks);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
