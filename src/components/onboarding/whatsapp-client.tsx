"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, QrCode, RefreshCw } from "lucide-react";
import Image from "next/image";

interface Props {
  tenantId: string;
}

export function OnboardingWhatsappClient({ tenantId }: Props) {
  const router = useRouter();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "pending" | "connected" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/uazapi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao conectar");
        setStatus("error");
        return;
      }
      if (data.status === "connected") {
        setStatus("connected");
        setTimeout(() => router.push("/"), 1500);
      } else if (data.qrCode) {
        setQrCode(data.qrCode);
        setStatus("pending");
      } else {
        setStatus("error");
        setError("Não foi possível gerar o QR code");
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Falha de rede");
    }
  }

  // Auto-inicia na primeira carga
  useEffect(() => {
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll status a cada 3s enquanto pending
  useEffect(() => {
    if (status !== "pending") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/uazapi/status?tenantId=${tenantId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "connected") {
          setStatus("connected");
          clearInterval(interval);
          setTimeout(() => router.push("/"), 1500);
        }
      } catch {
        /* silent */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [status, tenantId, router]);

  return (
    <div className="w-full max-w-md bg-surface border border-border rounded-2xl p-8 space-y-6 shadow-xl">
      <div className="flex justify-center">
        <Image
          src="/images/logo-full.png"
          alt="Growth Hub"
          width={180}
          height={38}
          className="brightness-0 invert"
        />
      </div>

      <div className="text-center space-y-1">
        <h1 className="text-h2 text-foreground">Conectar WhatsApp</h1>
        <p className="text-small text-muted">
          Escaneie o QR code abaixo com o WhatsApp da sua empresa pra começar.
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 flex flex-col items-center justify-center min-h-[300px]">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 text-muted">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-small">Gerando QR code...</p>
          </div>
        )}

        {status === "pending" && qrCode && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
            alt="QR code WhatsApp"
            className="max-w-full"
          />
        )}

        {status === "connected" && (
          <div className="flex flex-col items-center gap-3 text-success">
            <CheckCircle2 className="w-14 h-14" />
            <p className="font-medium">WhatsApp conectado!</p>
            <p className="text-small text-muted">Redirecionando...</p>
          </div>
        )}

        {status === "error" && (
          <div className="text-center space-y-2 text-error">
            <p className="text-small">{error}</p>
            <button
              onClick={connect}
              className="flex items-center gap-1.5 mx-auto mt-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90"
            >
              <RefreshCw className="w-4 h-4" />
              Tentar novamente
            </button>
          </div>
        )}
      </div>

      {status === "pending" && (
        <div className="space-y-3">
          <div className="text-small text-muted space-y-1">
            <p className="font-medium text-foreground">Como escanear:</p>
            <ol className="list-decimal list-inside space-y-0.5 ml-1">
              <li>Abra o WhatsApp no celular da empresa</li>
              <li>Toque em <strong>⋮ (menu)</strong> ou <strong>Ajustes</strong></li>
              <li>Toque em <strong>Aparelhos conectados</strong></li>
              <li>Toque em <strong>Conectar um aparelho</strong></li>
              <li>Aponte a câmera pro QR code acima</li>
            </ol>
          </div>

          <button
            onClick={connect}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-muted hover:text-foreground text-sm"
          >
            <QrCode className="w-4 h-4" />
            Gerar novo QR
          </button>
        </div>
      )}
    </div>
  );
}
