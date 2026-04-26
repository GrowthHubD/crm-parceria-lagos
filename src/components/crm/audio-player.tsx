"use client";

/**
 * AudioPlayer — player customizado para mensagens de áudio do CRM.
 *
 * Substitui o player nativo `<audio controls>` por uma UI consistente
 * com o design system: botão play/pause Lucide, barra de progresso clicável
 * e arrastável (seek), tempo atual/duração, controle de velocidade,
 * download e estados de loading/erro tratados.
 *
 * Funciona em fundos `bg-primary` (outgoing, texto branco) e `bg-surface-2`
 * (incoming, texto foreground) — controla as cores via prop `isOutgoing`.
 *
 * Acessibilidade:
 *  - aria-labels em todos os botões interativos.
 *  - role="slider" + setas Esquerda/Direita pra navegar (5s) na barra.
 *  - Foco visível, keyboard navigation.
 *
 * Bug fix histórico: data URIs com parâmetros tipo `audio/ogg; codecs=opus`
 * (com espaços) são parseadas pelo endpoint `/messages/[msgId]/media` —
 * este componente apenas consome a URL.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Play, Pause, Loader2, AlertCircle, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.5, 2] as const;
const SEEK_STEP_SECONDS = 5;

type AudioPlayerProps = {
  src: string;
  isOutgoing: boolean;
  /** Permite download em outro botão fora do player. Default: true. */
  downloadable?: boolean;
  /** Largura do player (default 240). */
  width?: number;
};

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function AudioPlayer({
  src,
  isOutgoing,
  downloadable = true,
  width = 240,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("loading");

  const validDuration = Number.isFinite(duration) && duration > 0;
  const progressPct = validDuration
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;

  // Cores: outgoing usa bg-primary (texto branco), incoming usa bg-surface-2 (texto foreground).
  // Para cada estado, definimos tokens compatíveis com tema.
  const palette = useMemo(() => {
    if (isOutgoing) {
      return {
        button: "bg-white/20 hover:bg-white/30 text-white",
        track: "bg-white/25",
        fill: "bg-white",
        thumb: "bg-white",
        text: "text-white/80",
        speed: "text-white/85 hover:text-white",
        speedActive: "bg-white/20",
      };
    }
    return {
      button: "bg-primary/15 hover:bg-primary/25 text-primary",
      track: "bg-foreground/15",
      fill: "bg-primary",
      thumb: "bg-primary",
      text: "text-muted",
      speed: "text-muted hover:text-foreground",
      speedActive: "bg-primary/15 text-primary",
    };
  }, [isOutgoing]);

  // ── Lifecycle handlers ───────────────────────────────────────────────

  // Truque pra obter duração de blobs OGG/Opus do WhatsApp (que costumam
  // vir sem header de duração). Setando currentTime para um valor enorme,
  // o navegador força o decoder a ler o arquivo todo e dispara
  // `durationchange` com o valor real.
  const handleLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!Number.isFinite(el.duration) || el.duration === 0) {
      try {
        el.currentTime = 1e101;
      } catch {
        /* alguns browsers throwam — segue o jogo */
      }
    } else {
      setDuration(el.duration);
      setStatus("ready");
    }
  }, []);

  const handleDurationChange = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration);
      // Só rebobina se tiver sido o truque do "1e101" (currentTime ficou absurdamente alto).
      // Sem essa guarda, durationchange reseta currentTime quando o usuário
      // já está navegando ou tocando.
      if (el.currentTime > el.duration + 1) {
        el.currentTime = 0;
        setCurrentTime(0);
      }
      setStatus("ready");
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (seekingRef.current) return; // não fight seek manual em curso
    const el = audioRef.current;
    if (!el) return;
    setCurrentTime(el.currentTime);
  }, []);

  const handlePlay = useCallback(() => setPlaying(true), []);
  const handlePause = useCallback(() => setPlaying(false), []);
  const handleEnded = useCallback(() => {
    setPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleError = useCallback(() => {
    setStatus("error");
    setPlaying(false);
  }, []);

  const handleLoadStart = useCallback(() => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
  }, []);

  const handleCanPlay = useCallback(() => {
    setStatus("ready");
  }, []);

  // ── Controles ────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || status === "error") return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => setStatus("error"));
    }
  }, [playing, status]);

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }, [speedIdx]);

  // Re-aplica playbackRate sempre que src muda (preserva preferência do usuário).
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIdx];
  }, [src, speedIdx]);

  // ── Seek (clique e arrasto) ──────────────────────────────────────────

  const seekToClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const audio = audioRef.current;
      if (!track || !audio || !validDuration) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newTime = ratio * duration;
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration, validDuration]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!validDuration) return;
      e.preventDefault();
      seekingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekToClientX(e.clientX);
    },
    [seekToClientX, validDuration]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!seekingRef.current) return;
      seekToClientX(e.clientX);
    },
    [seekToClientX]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!seekingRef.current) return;
      seekingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    []
  );

  const onTrackKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !validDuration) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const t = Math.min(duration, audio.currentTime + SEEK_STEP_SECONDS);
        audio.currentTime = t;
        setCurrentTime(t);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const t = Math.max(0, audio.currentTime - SEEK_STEP_SECONDS);
        audio.currentTime = t;
        setCurrentTime(t);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        togglePlay();
      }
    },
    [duration, validDuration, togglePlay]
  );

  // ── Render ───────────────────────────────────────────────────────────

  if (status === "error") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-xs italic opacity-80",
          isOutgoing ? "text-white/85" : "text-muted"
        )}
        style={{ width }}
      >
        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span>{isOutgoing ? "Áudio enviado (preview indisponível)" : "Áudio indisponível"}</span>
      </div>
    );
  }

  const isLoading = status === "loading";
  const sliderValueNow = validDuration ? Math.round(currentTime) : 0;
  const sliderValueMax = validDuration ? Math.round(duration) : 0;

  return (
    <div
      className="flex items-center gap-2"
      style={{ width }}
      role="group"
      aria-label="Player de áudio"
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadStart={handleLoadStart}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleDurationChange}
        onCanPlay={handleCanPlay}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleError}
      />

      {/* Play/Pause */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={isLoading}
        aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
        aria-pressed={playing}
        className={cn(
          "shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
          isOutgoing ? "focus-visible:ring-white/60" : "focus-visible:ring-primary/60",
          palette.button,
          isLoading && "opacity-70 cursor-wait"
        )}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        ) : playing ? (
          <Pause className="w-4 h-4" aria-hidden />
        ) : (
          <Play className="w-4 h-4 ml-0.5" aria-hidden />
        )}
      </button>

      {/* Track + tempo */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={sliderValueMax}
          aria-valuenow={sliderValueNow}
          aria-valuetext={`${formatTime(currentTime)}${validDuration ? ` de ${formatTime(duration)}` : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onTrackKeyDown}
          className={cn(
            "relative h-1.5 rounded-full select-none touch-none",
            validDuration ? "cursor-pointer" : "cursor-not-allowed",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
            isOutgoing ? "focus-visible:ring-white/60" : "focus-visible:ring-primary/60",
            palette.track
          )}
        >
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full transition-[width]", palette.fill)}
            style={{ width: `${progressPct}%` }}
          />
          {validDuration && (
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full shadow",
                "opacity-0 group-hover:opacity-100 transition-opacity",
                palette.thumb
              )}
              style={{ left: `${progressPct}%` }}
              aria-hidden
            />
          )}
        </div>
        <p className={cn("text-[10px] tabular-nums leading-none", palette.text)}>
          {formatTime(currentTime)}
          {validDuration ? ` / ${formatTime(duration)}` : ""}
        </p>
      </div>

      {/* Velocidade */}
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={`Velocidade ${SPEEDS[speedIdx]}x — clique pra alternar`}
        className={cn(
          "shrink-0 text-[10px] font-bold w-9 py-1 rounded-md transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
          isOutgoing ? "focus-visible:ring-white/60" : "focus-visible:ring-primary/60",
          palette.speed,
          speedIdx > 0 && palette.speedActive
        )}
      >
        {SPEEDS[speedIdx]}x
      </button>

      {/* Download */}
      {downloadable && (
        <a
          href={src}
          download
          aria-label="Baixar áudio"
          title="Baixar áudio"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
            isOutgoing
              ? "text-white/70 hover:text-white hover:bg-white/15 focus-visible:ring-white/60"
              : "text-muted hover:text-foreground hover:bg-foreground/10 focus-visible:ring-primary/60"
          )}
        >
          <Download className="w-3.5 h-3.5" aria-hidden />
        </a>
      )}
    </div>
  );
}
