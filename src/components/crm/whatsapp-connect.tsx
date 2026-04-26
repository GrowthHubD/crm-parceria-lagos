"use client";

import { useState, useEffect, useCallback } from "react";
import { Smartphone, CheckCircle2, Loader2, RefreshCw, QrCode, RotateCcw, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface WhatsAppConnectProps {
  tenantId?: string; // para superadmin conectar outro tenant
}

type ConnectionStatus = "loading" | "not_configured" | "pending" | "connected";

export function WhatsAppConnect({ tenantId }: WhatsAppConnectProps) {
  const [status, setStatus] = useState<ConnectionStatus>("loading");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const url = tenantId ? `/api/uazapi/status?tenantId=${tenantId}` : "/api/uazapi/status";
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();

      setStatus(data.status as ConnectionStatus);
      setQrCode(data.qrCode ?? null);
      setPhoneNumber(data.phoneNumber ?? null);
    } catch {
      setStatus("not_configured");
    }
  }, [tenantId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Poll: 3s quando pending (aguardando scan), 8s quando not_configured (pode ter reconectado)
  useEffect(() => {
    if (status === "connected" || status === "loading") return;
    const interval = setInterval(checkStatus, status === "pending" ? 3000 : 8000);
    return () => clearInterval(interval);
  }, [status, checkStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/uazapi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tenantId ? { tenantId } : {}),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Erro ao conectar");
        return;
      }

      const data = await res.json();
      setStatus(data.status);
      setQrCode(data.qrCode ?? null);
      setPhoneNumber(data.phoneNumber ?? null);

      if (data.status === "connected") {
        toast.success("WhatsApp conectado!");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (silent = false) => {
    try {
      const res = await fetch("/api/uazapi/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tenantId ? { tenantId } : {}),
      });
      if (!res.ok) {
        if (!silent) toast.error("Erro ao desconectar");
        return false;
      }
      setStatus("not_configured");
      setQrCode(null);
      setPhoneNumber(null);
      if (!silent) toast.success("WhatsApp desconectado");
      return true;
    } catch {
      if (!silent) toast.error("Erro de conexão");
      return false;
    }
  };

  const handleResetQR = async () => {
    setConnecting(true);
    const ok = await handleDisconnect(true);
    if (ok) await handleConnect();
    else setConnecting(false);
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center",
          status === "connected" ? "bg-success/10" : "bg-surface-2"
        )}>
          <Smartphone className={cn("w-5 h-5", status === "connected" ? "text-success" : "text-muted")} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Conexão WhatsApp</h3>
          <p className="text-xs text-muted">
            {status === "connected" && phoneNumber && `Conectado: ${phoneNumber}`}
            {status === "pending" && "Aguardando escaneamento do QR Code"}
            {status === "not_configured" && "Nenhuma instância configurada"}
            {status === "loading" && "Verificando..."}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {status === "connected" && (
            <>
              <span className="flex items-center gap-1 px-2.5 py-1 bg-success/10 text-success text-xs font-medium rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Conectado
              </span>
              <button
                onClick={() => handleDisconnect()}
                className="p-1.5 rounded text-muted hover:text-danger hover:bg-surface-2 transition-colors cursor-pointer"
                title="Desconectar"
              >
                <Power className="w-4 h-4" />
              </button>
            </>
          )}

          {status === "pending" && (
            <>
              <button
                onClick={handleResetQR}
                disabled={connecting}
                className="p-1.5 rounded text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
                title="Resetar QR Code"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={checkStatus}
                className="p-1.5 rounded text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
                title="Atualizar status"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* QR Code display */}
      {status === "pending" && qrCode && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="bg-white p-3 rounded-xl">
            <img
              src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
              alt="QR Code WhatsApp"
              className="w-48 h-48"
            />
          </div>
          <p className="text-xs text-muted text-center max-w-xs">
            Abra o WhatsApp no celular, vá em Dispositivos Vinculados e escaneie o QR Code acima
          </p>
          <div className="flex items-center gap-1 text-xs text-muted animate-pulse">
            <Loader2 className="w-3 h-3 animate-spin" />
            Aguardando conexão...
          </div>
        </div>
      )}

      {/* Pending sem QR — aguardando gerar */}
      {status === "pending" && !qrCode && (
        <div className="flex flex-col items-center gap-3 py-6">
          <QrCode className="w-12 h-12 text-muted" />
          <p className="text-xs text-muted">QR Code sendo gerado...</p>
          <button
            onClick={checkStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary hover:text-primary-hover transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Tentar novamente
          </button>
        </div>
      )}

      {/* Não configurado — botão conectar */}
      {status === "not_configured" && (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
        >
          {connecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Smartphone className="w-4 h-4" />
          )}
          {connecting ? "Criando instância..." : "Conectar WhatsApp"}
        </button>
      )}
    </div>
  );
}
