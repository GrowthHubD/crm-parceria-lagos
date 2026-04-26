"use client";

/**
 * AudioRecorder — gravação de mensagem de voz no CRM (estilo WhatsApp).
 *
 * Estados:
 *   - idle     : botão de mic (entry point)
 *   - recording: [🗑] [●pulse] 0:03 [waveform-fino] [⏸] [➤circular-branco]
 *   - paused   : igual recording, mas sem pulse + botão play em vez de pause
 *   - preview  : player inline + descartar + re-gravar + enviar
 *   - sending  : spinner enquanto POSTa pra /api/crm/[id]/send-media
 *
 * - Limite: 5 min auto-stop
 * - Pause/Resume usa MediaRecorder.pause()/resume() (mantém microfone ativo)
 * - mimeType: prefere `audio/webm;codecs=opus` ou `audio/ogg;codecs=opus`
 *   (Uazapi/WhatsApp aceita ambos quando vão como `type: "ptt"`).
 * - Cleanup obrigatório: tracks do MediaStream são parados ao
 *   desmontar, cancelar, enviar ou re-gravar.
 *
 * `onSent({ message })` recebe a msg recém-inserida no DB pra
 * o pai adicionar otimisticamente na lista.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Send, Trash2, RotateCcw, Play, Pause, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface AudioRecorderProps {
  conversationId: string;
  disabled?: boolean;
  /** Chamado quando o áudio é enviado com sucesso. */
  onSent: (message: unknown) => void;
  /** Chamado quando começa/termina a gravação (host esconde os outros botões). */
  onActiveChange?: (active: boolean) => void;
}

const MAX_DURATION_SEC = 5 * 60; // 5 min

/** Escolhe o mimeType suportado pelo browser, na ordem de preferência. */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) {
      return m;
    }
  }
  return ""; // browser usa o default
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

type State = "idle" | "recording" | "paused" | "preview" | "sending";

export function AudioRecorder({
  conversationId,
  disabled,
  onSent,
  onActiveChange,
}: AudioRecorderProps) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Notify host when recording is active (so it can hide other inputs)
  useEffect(() => {
    onActiveChange?.(
      state === "recording" ||
        state === "paused" ||
        state === "preview" ||
        state === "sending"
    );
  }, [state, onActiveChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTracks();
      stopTick();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
    }
    mediaRecorderRef.current = null;
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch { /* noop */ }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }

  function startTick() {
    stopTick();
    tickRef.current = setInterval(() => {
      setElapsed((e) => {
        const next = e + 1;
        if (next >= MAX_DURATION_SEC) {
          stopRecording();
          return MAX_DURATION_SEC;
        }
        return next;
      });
    }, 1000);
  }

  function stopTick() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function startRecording() {
    if (disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      // AudioContext + AnalyserNode pra waveform em tempo real
      try {
        const AudioContextCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextCtor) {
          const ctx = new AudioContextCtor();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          // fftSize maior dá mais bins → waveform mais "denso" tipo WhatsApp
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.7;
          source.connect(analyser);
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
        }
      } catch {
        // se AudioContext falhar, segue sem waveform (não bloqueia gravação)
      }

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopTick();
        // Liberar microfone imediatamente
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (cancelledRef.current) {
          chunksRef.current = [];
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size === 0) {
          toast.error("Áudio vazio");
          setState("idle");
          return;
        }
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setState("preview");
      };

      recorder.start();
      setElapsed(0);
      startTick();
      setState("recording");
    } catch (e) {
      const err = e as Error;
      if (err?.name === "NotAllowedError") {
        toast.error("Permissão de microfone negada");
      } else {
        toast.error("Não foi possível acessar o microfone");
      }
      stopTracks();
      setState("idle");
    }
  }

  function pauseRecording() {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "recording") return;
    try {
      rec.pause();
      stopTick();
      setState("paused");
    } catch {
      /* noop */
    }
  }

  function resumeRecording() {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "paused") return;
    try {
      rec.resume();
      startTick();
      setState("recording");
    } catch {
      /* noop */
    }
  }

  function stopRecording() {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      cancelledRef.current = false;
      // resume primeiro se estiver pausado pra garantir que o onstop dispare limpo
      if (rec.state === "paused") {
        try { rec.resume(); } catch { /* noop */ }
      }
      rec.stop();
    }
  }

  function cancelRecording() {
    cancelledRef.current = true;
    stopTick();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch { /* noop */ }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    chunksRef.current = [];
    blobRef.current = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setElapsed(0);
    setState("idle");
  }

  async function rerecord() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    blobRef.current = null;
    setElapsed(0);
    await startRecording();
  }

  async function sendFromRecording() {
    // Atalho: parar gravação E já enviar (skipa preview)
    // Como onstop é assíncrono, marca pra enviar e deixa o stop disparar o flow normal.
    stopRecording();
  }

  async function sendRecording() {
    const blob = blobRef.current;
    if (!blob) return;
    setState("sending");
    try {
      const dataUri = await blobToDataUri(blob);
      // Servidor troca audio/webm → audio/ogg pra ir como PTT no WhatsApp.
      // .ogg é o que aparece no WhatsApp como mensagem de voz.
      const res = await fetch(`/api/crm/${conversationId}/send-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: dataUri,
          fileName: `audio-${Date.now()}.ogg`,
          isAudio: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(`Falhou: ${data.error ?? "erro ao enviar áudio"}`);
        setState("preview");
        return;
      }
      const data = await res.json();
      onSent(data.message);

      // Reset
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      blobRef.current = null;
      setElapsed(0);
      setState("idle");
    } catch (e) {
      toast.error(`Erro: ${e instanceof Error ? e.message : "rede"}`);
      setState("preview");
    }
  }

  // ── UI ──

  if (state === "idle") {
    return (
      <button
        onClick={startRecording}
        disabled={disabled}
        className="p-2.5 text-muted hover:text-foreground hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
        title="Gravar áudio"
        aria-label="Gravar áudio"
      >
        <Mic className="w-4 h-4" />
      </button>
    );
  }

  if (state === "recording" || state === "paused") {
    const isPaused = state === "paused";
    return (
      <div className="flex-1 flex items-center gap-2 bg-surface border border-border rounded-full pl-2 pr-1.5 py-1.5">
        {/* Lixeira — descarta a gravação */}
        <button
          onClick={cancelRecording}
          aria-label="Descartar gravação"
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
          title="Descartar"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {/* Bolinha vermelha pulsando (estática quando pausado) */}
        <span className="relative flex shrink-0 items-center justify-center w-2.5 h-2.5" aria-hidden>
          {!isPaused && (
            <span className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-error opacity-60 animate-ping" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-error" />
        </span>

        {/* Timer */}
        <span
          className="text-xs text-foreground tabular-nums font-medium shrink-0"
          aria-live="polite"
          aria-label={`Duração: ${fmtTime(elapsed)}`}
        >
          {fmtTime(elapsed)}
        </span>

        {/* Waveform tipo WhatsApp */}
        <Waveform analyser={analyserRef.current} active={!isPaused} />

        {/* Indicador "1x" decorativo (referência do screenshot) */}
        <span
          className="shrink-0 hidden sm:flex items-center gap-0.5 text-[10px] font-medium text-muted px-1.5 py-0.5 rounded-full border border-border"
          aria-hidden
          title="Velocidade de reprodução (após enviar)"
        >
          <Timer className="w-2.5 h-2.5" />
          1x
        </span>

        {/* Pause / Resume */}
        <button
          onClick={isPaused ? resumeRecording : pauseRecording}
          aria-label={isPaused ? "Retomar gravação" : "Pausar gravação"}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
          title={isPaused ? "Retomar" : "Pausar"}
        >
          {isPaused ? (
            <Play className="w-4 h-4 ml-0.5" />
          ) : (
            <Pause className="w-4 h-4" />
          )}
        </button>

        {/* Send circular branco com ícone escuro (estilo WhatsApp) */}
        <button
          onClick={sendFromRecording}
          aria-label="Concluir e enviar áudio"
          className="shrink-0 w-10 h-10 rounded-full bg-white text-background hover:bg-white/90 transition-colors cursor-pointer flex items-center justify-center shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          title="Concluir gravação"
        >
          <Send className="w-4 h-4 fill-current" strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  if (state === "preview" || state === "sending") {
    return (
      <div className="flex-1 flex items-center gap-1.5 bg-surface-2 border border-border rounded-lg pl-2 pr-1.5 py-1.5">
        <button
          onClick={cancelRecording}
          disabled={state === "sending"}
          aria-label="Descartar gravação"
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-error hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Descartar"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {previewUrl && <PreviewPlayer src={previewUrl} disabled={state === "sending"} />}

        <button
          onClick={rerecord}
          disabled={state === "sending"}
          aria-label="Re-gravar"
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-surface transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Re-gravar"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={sendRecording}
          disabled={state === "sending"}
          aria-label="Enviar áudio"
          className={cn(
            "shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-md hover:bg-primary-hover transition-colors cursor-pointer flex items-center justify-center",
            state === "sending" && "opacity-70 cursor-wait"
          )}
          title="Enviar"
        >
          {state === "sending" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    );
  }

  return null;
}

/**
 * Visualizador de ondas sonoras estilo WhatsApp.
 *
 * - 60+ barras finas (1.5px width, 1.5px gap) com cantos arredondados
 * - Quando active=true: lê analyser e cria efeito de "scroll" da direita pra esquerda
 *   (como WhatsApp: ondas novas entram pela direita, antigas saem pela esquerda)
 * - Quando active=false (paused): mantém último estado congelado
 * - Cor: text-foreground (branco/claro no dark theme)
 */
function Waveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  // Histórico de amplitudes (estilo WhatsApp scroll). Mantemos fora do React.
  const historyRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!active || !analyser) return; // pausa = congela última frame

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize canvas pra resolução do device pra não ficar borrado
    const dpr = window.devicePixelRatio || 1;
    let cssW = 0;
    let cssH = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = rect.width;
      cssH = rect.height;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0); // reset matrix antes de scale
      ctx.scale(dpr, dpr);
    };
    resize();

    const bufferLength = analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);

    // Cor pega do CSS — herdada do parent text-foreground
    const computedColor = getComputedStyle(canvas).color || "#fff";

    // Estilo WhatsApp: barras de 1.5px com 1.5px de gap (~3px por barra total)
    const BAR_WIDTH = 1.5;
    const BAR_GAP = 1.5;
    const STEP = BAR_WIDTH + BAR_GAP;

    function draw() {
      if (!analyser || !ctx || !canvas) return;
      analyser.getByteFrequencyData(data);

      // Calcula amplitude média ponderada (foco em freqs de voz)
      // Pega só o range útil (~85Hz–4kHz, ~primeiros 45% das bins)
      const usefulBins = Math.floor(bufferLength * 0.45);
      let sum = 0;
      for (let i = 0; i < usefulBins; i++) {
        sum += data[i] ?? 0;
      }
      const avg = sum / usefulBins / 255; // 0..1

      // Adiciona ao histórico (push à direita)
      const maxBars = Math.max(20, Math.floor(cssW / STEP));
      historyRef.current.push(avg);
      if (historyRef.current.length > maxBars) {
        historyRef.current.splice(0, historyRef.current.length - maxBars);
      }

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = computedColor;

      const history = historyRef.current;
      const startX = cssW - history.length * STEP;

      for (let i = 0; i < history.length; i++) {
        const norm = history[i] ?? 0;
        // Mínimo 8% pra mostrar baseline mesmo no silêncio
        // Boost (sqrt) pra valores baixos ficarem mais visíveis
        const boosted = Math.sqrt(norm);
        const barHeight = Math.max(cssH * 0.08, boosted * cssH * 0.95);
        const x = startX + i * STEP;
        if (x + BAR_WIDTH < 0) continue; // off-screen à esquerda
        const y = (cssH - barHeight) / 2;
        const r = BAR_WIDTH / 2;

        // Pill (fully rounded) com arcTo
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + BAR_WIDTH, y, x + BAR_WIDTH, y + barHeight, r);
        ctx.arcTo(x + BAR_WIDTH, y + barHeight, x, y + barHeight, r);
        ctx.arcTo(x, y + barHeight, x, y, r);
        ctx.arcTo(x, y, x + BAR_WIDTH, y, r);
        ctx.closePath();
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    }
    draw();

    // Re-resize on window resize (responsivo)
    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [analyser, active]);

  // Reset histórico quando o analyser muda (nova gravação)
  useEffect(() => {
    if (!analyser) {
      historyRef.current = [];
    }
  }, [analyser]);

  return (
    <div className="flex-1 min-w-0 h-7 flex items-center text-foreground">
      <canvas ref={canvasRef} className="w-full h-full block" aria-hidden />
    </div>
  );
}

/**
 * Mini-player inline pra preview do áudio recém-gravado.
 * Substitui o `<audio controls>` nativo por UI consistente com o design system.
 * Render: [▶/❚❚] ▬▬▬▬░░░░ 0:02 / 0:03
 */
function PreviewPlayer({ src, disabled }: { src: string; disabled: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  const validDuration = Number.isFinite(duration) && duration > 0;
  const progressPct = validDuration
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;

  // Truque pra forçar leitura completa do header em blobs WebM/OGG
  // (alguns browsers retornam Infinity até seek-to-end forçar parsing).
  const handleLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!Number.isFinite(el.duration) || el.duration === 0) {
      try {
        el.currentTime = 1e101;
      } catch {
        /* noop */
      }
    } else {
      setDuration(el.duration);
      setReady(true);
    }
  }, []);

  const handleDurationChange = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration);
      if (el.currentTime > el.duration + 1) {
        el.currentTime = 0;
        setCurrentTime(0);
      }
      setReady(true);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (seekingRef.current) return;
    const el = audioRef.current;
    if (!el) return;
    setCurrentTime(el.currentTime);
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || disabled) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => {
        /* swallow — preview loca */
      });
    }
  }, [playing, disabled]);

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
      if (!validDuration || disabled) return;
      e.preventDefault();
      seekingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekToClientX(e.clientX);
    },
    [seekToClientX, validDuration, disabled]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!seekingRef.current) return;
      seekToClientX(e.clientX);
    },
    [seekToClientX]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return;
    seekingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }, []);

  return (
    <div className="flex-1 min-w-0 flex items-center gap-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleDurationChange}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        disabled={disabled || !ready}
        aria-label={playing ? "Pausar" : "Tocar"}
        aria-pressed={playing}
        className={cn(
          "shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors",
          "bg-primary/15 hover:bg-primary/25 text-primary",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1",
          (disabled || !ready) && "opacity-60 cursor-wait"
        )}
      >
        {!ready ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : playing ? (
          <Pause className="w-3.5 h-3.5" />
        ) : (
          <Play className="w-3.5 h-3.5 ml-0.5" />
        )}
      </button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Posição do áudio"
        aria-valuemin={0}
        aria-valuemax={validDuration ? Math.round(duration) : 0}
        aria-valuenow={validDuration ? Math.round(currentTime) : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "flex-1 min-w-0 h-1.5 rounded-full bg-foreground/15 relative select-none touch-none",
          validDuration && !disabled ? "cursor-pointer" : "cursor-default",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1"
        )}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width]"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <span className="shrink-0 text-[10px] tabular-nums text-muted leading-none whitespace-nowrap">
        {fmtTime(Math.floor(currentTime))}
        {validDuration ? ` / ${fmtTime(Math.round(duration))}` : ""}
      </span>
    </div>
  );
}
