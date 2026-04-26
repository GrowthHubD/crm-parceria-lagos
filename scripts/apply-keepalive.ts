import "dotenv/config";
import postgres from "postgres";

const SQL = `
-- 1. Cria a tabela minimalista para registrar os "batimentos" (pings)
CREATE TABLE IF NOT EXISTS public.ativacao_supabase (
  id BIGINT PRIMARY KEY,
  atualiza BOOLEAN DEFAULT FALSE,
  last_ping TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Insere a linha inicial
INSERT INTO public.ativacao_supabase (id, atualiza)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- 3. Habilita extensão pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 4. Permissões
GRANT USAGE ON SCHEMA cron TO postgres;
`;

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
  const sql = postgres(url, { prepare: false, max: 1 });

  console.log("→ Criando tabela + extensão pg_cron...");
  await sql.unsafe(SQL);
  console.log("✓ Tabela e extensão OK");

  console.log("→ Removendo job antigo (se existir)...");
  try {
    await sql.unsafe(`SELECT cron.unschedule('keep-supabase-alive-job');`);
  } catch {
    // não existe, ignora
  }

  console.log("→ Agendando job horário...");
  await sql.unsafe(`
    SELECT cron.schedule(
      'keep-supabase-alive-job',
      '0 * * * *',
      $job$
      UPDATE public.ativacao_supabase
      SET atualiza = NOT atualiza,
          last_ping = timezone('utc'::text, now())
      WHERE id = 1;
      $job$
    );
  `);
  console.log("✓ Job agendado");

  const jobs = await sql`SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'keep-supabase-alive-job';`;
  console.log("\nStatus do job:", jobs);

  await sql.end();
  console.log("\n✅ Keep-alive configurado com sucesso.");
}

main().catch((err) => {
  console.error("❌ Falha:", err);
  process.exit(1);
});
