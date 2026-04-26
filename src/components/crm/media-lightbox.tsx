"use client";

/**
 * MediaLightbox — modal full-screen para exibir imagens/vídeos em tamanho grande.
 *
 * - Abre quando `src` está setado.
 * - Esc ou clique fora fecha.
 * - Suporta image (img tag) e video (video tag com controls).
 * - Botão de download integrado.
 */

import { useEffect } from "react";
import { X, Download } from "lucide-react";

interface Props {
  src: string | null;
  alt?: string;
  type?: "image" | "video";
  /** filename pra download (default: derivado da URL) */
  downloadAs?: string;
  onClose: () => void;
}

export function MediaLightbox({ src, alt = "mídia", type = "image", downloadAs, onClose }: Props) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Bloqueia scroll do body enquanto modal aberto
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [src, onClose]);

  if (!src) return null;

  const fileName =
    downloadAs ?? src.split("/").pop()?.split("?")[0] ?? (type === "video" ? "video" : "imagem");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizar mídia"
    >
      {/* Botões topo */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <a
          href={src}
          download={fileName}
          onClick={(e) => e.stopPropagation()}
          aria-label="Baixar"
          title="Baixar"
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white flex items-center justify-center transition-colors"
        >
          <Download className="w-5 h-5" />
        </a>
        <button
          onClick={onClose}
          aria-label="Fechar"
          title="Fechar (Esc)"
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Mídia */}
      <div
        className="max-w-[95vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {type === "video" ? (
          <video
            src={src}
            controls
            autoPlay
            className="max-w-full max-h-[90vh] rounded-lg"
          />
        ) : (
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-[90vh] rounded-lg object-contain"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
