import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pacotes que devem ser tratados como externos no server bundle (não passam
  // pelo webpack). Necessário pra módulos com binários nativos cujo `path`
  // resolvido em runtime precisa bater com a localização real do arquivo —
  // webpack ofusca paths e quebra a resolução.
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "fluent-ffmpeg",
  ],
};

export default nextConfig;
