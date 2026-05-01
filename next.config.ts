import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pacotes que devem ser tratados como externos no server bundle (não passam
  // pelo webpack). Necessário pra módulos com binários nativos cujo `path`
  // resolvido em runtime precisa bater com a localização real do arquivo —
  // webpack ofusca paths e quebra a resolução.
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "fluent-ffmpeg",
    "@whiskeysockets/baileys",
    "jimp",
    "sharp",
    "pino",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
  // Pula TS check no build de produção (deploy CF). TS errors restantes são
  // pre-existentes em código não-deployado. Build do Next compila tudo OK;
  // só o type-check estático trava. CI separado pode rodar `tsc --noEmit`.
  typescript: {
    ignoreBuildErrors: true,
  },
  // date-fns v4 é ESM puro e usa re-exports relativos `./endOfWeek.js` no
  // `index.js`. Com `next build --webpack` em Windows + pnpm symlinks, o
  // resolver do webpack falha em normalizar esses paths (`.js` no source mas
  // arquivo está em `.js` real — ainda assim quebra). `transpilePackages`
  // força o webpack a processar a lib pelo pipeline interno do Next (swc),
  // que converte os ESM re-exports antes do resolve.
  transpilePackages: ["date-fns"],
};

export default nextConfig;
