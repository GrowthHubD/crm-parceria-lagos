"use client";

/**
 * StickerView — renderiza figurinhas (estáticas e animadas) do WhatsApp.
 *
 * Stickers podem chegar como:
 *   - image/webp     → estático (renderiza com <img>; webp anim funciona em browsers modernos)
 *   - video/webm     → animated sticker (renderiza com <video autoplay loop muted>)
 *   - video/mp4      → quando Uazapi converte o webm pra mp4 (renderiza com <video>)
 *
 * Detecta o tipo via fetch HEAD pra obter Content-Type, OR via sniff via mediaUrl.
 * Tamanho padrão: ~150px (estilo balão de figurinha do WhatsApp).
 */

import { useState } from "react";

interface Props {
  /** URL da mídia (proxy ou direta) */
  src: string;
  /** Hint do mime type (se conhecido — evita round-trip de detecção). */
  mimeHint?: string;
}

/**
 * Heurística rápida pra inferir tipo a partir da URL — evita HEAD request.
 * Se a URL termina em `.webm`/`.mp4` é vídeo (animated sticker convertido).
 * Senão assume image (webp/png/etc — browser handle).
 */
function guessIsVideo(src: string, mimeHint?: string): boolean {
  if (mimeHint?.startsWith("video/")) return true;
  if (mimeHint?.startsWith("image/")) return false;
  // Tira query string antes de checar extensão
  const path = src.split("?")[0].toLowerCase();
  return /\.(webm|mp4|mov)$/i.test(path);
}

export function StickerView({ src, mimeHint }: Props) {
  const [error, setError] = useState(false);

  if (error) {
    return <p className="italic opacity-70 text-xs">🧩 Figurinha (não suportada)</p>;
  }

  const isVideo = guessIsVideo(src, mimeHint);

  if (isVideo) {
    return (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        className="max-w-[160px] max-h-[160px] rounded-lg"
        onError={() => setError(true)}
      />
    );
  }

  // image/webp ou outro image/* — browser detecta automaticamente
  return (
    <img
      src={src}
      alt="figurinha"
      className="max-w-[160px] max-h-[160px]"
      style={{ background: "transparent" }}
      onError={() => setError(true)}
      draggable={false}
    />
  );
}
