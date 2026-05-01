"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ArrowLeft, Send, Loader2, Tag, UserPlus, GitBranch, CornerUpLeft, X, ChevronDown, Star, Copy, Download, CheckSquare, Plus, FileText, Users, RotateCcw, Trash2, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { NextFollowUpBadge, type NextFollowUpData } from "@/components/automations/next-followup-badge";
import { AudioPlayer } from "@/components/crm/audio-player";
import { AudioRecorder } from "@/components/crm/audio-recorder";
import { MediaLightbox } from "@/components/crm/media-lightbox";
import { StickerView } from "@/components/crm/sticker-view";
import { QuickTaskModal } from "@/components/crm/quick-task-modal";

interface Message {
  id: string;
  direction: string;
  content: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  status: string | null;
  timestamp: string;
  quotedMessageId: string | null;
  quotedContent: string | null;
  senderName: string | null;
  isStarred: boolean;
}

interface StagedFile {
  localId: string;
  dataUri: string;
  fileName: string;
  isImage: boolean;
}

interface Conversation {
  id: string;
  contactPhone: string;
  contactJid: string | null;
  contactName: string | null;
  contactPushName: string | null;
  contactProfilePicUrl: string | null;
  contactAlias: string | null;
  classification: string;
  unreadCount: number;
}

interface LinkedLead {
  id: string;
  name: string;
  companyName: string | null;
  stageName: string | null;
  stageColor: string | null;
  estimatedValue: string | null;
  isConverted: boolean;
  nextFollowUp?: NextFollowUpData | null;
}

interface MenuAction { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }

function MessageMenu({ actions, isOutgoing }: { actions: MenuAction[]; isOutgoing: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted hover:text-foreground"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className={cn(
          "absolute z-50 top-6 w-44 bg-surface border border-border rounded-xl shadow-lg py-1 text-sm",
          isOutgoing ? "right-0" : "left-0"
        )}>
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => { a.onClick(); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-2 transition-colors text-left",
                a.danger ? "text-error" : "text-foreground"
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Gallery for grouped consecutive image messages
function ImageGallery({
  images,
  conversationId,
  onImageClick,
}: {
  images: Message[];
  conversationId: string;
  isOutgoing?: boolean;
  onImageClick?: (src: string) => void;
}) {
  // Otimização: usa publicUrl direto se disponível (evita proxy)
  const srcOf = (msg: Message) =>
    msg.mediaUrl && msg.mediaUrl.startsWith("http")
      ? msg.mediaUrl
      : `/api/crm/${conversationId}/messages/${msg.id}/media`;

  if (images.length === 1) {
    const src = srcOf(images[0]);
    return (
      <img
        src={src}
        alt="imagem"
        className="max-w-[220px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
        onClick={() => onImageClick?.(src)}
        draggable={false}
      />
    );
  }

  const visible = images.slice(0, 4);
  const overflow = images.length - 4;

  const gridClass =
    images.length === 2
      ? "grid-cols-2"
      : "grid-cols-2";

  return (
    <div className={cn("grid gap-0.5 rounded-lg overflow-hidden", gridClass)} style={{ width: 220 }}>
      {visible.map((img, idx) => {
        const isLast = idx === 3 && overflow > 0;
        const spanFull = images.length === 3 && idx === 0;
        const src = srcOf(img);
        return (
          <div
            key={img.id}
            className={cn("relative overflow-hidden bg-black/10 cursor-pointer hover:opacity-90 transition-opacity", spanFull && "col-span-2")}
            style={{ aspectRatio: "1" }}
            onClick={() => onImageClick?.(src)}
          >
            <img
              src={src}
              alt="imagem"
              className="w-full h-full object-cover"
              draggable={false}
            />
            {isLast && overflow > 0 && (
              <div className="absolute inset-0 bg-black/55 flex items-center justify-center pointer-events-none">
                <span className="text-white font-bold text-2xl">+{overflow}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CLASSIFICATION_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "hot", label: "Quente 🔥" },
  { value: "warm", label: "Morno" },
  { value: "cold", label: "Frio" },
  { value: "active_client", label: "Cliente Ativo" },
];

type DisplayItem =
  | { kind: "message"; msg: Message }
  | { kind: "album"; messages: Message[]; direction: string };

function groupMessages(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.mediaType === "image") {
      const group: Message[] = [msg];
      let j = i + 1;
      while (
        j < messages.length &&
        messages[j].mediaType === "image" &&
        messages[j].direction === msg.direction
      ) {
        group.push(messages[j]);
        j++;
      }
      if (group.length > 1) {
        items.push({ kind: "album", messages: group, direction: msg.direction });
      } else {
        items.push({ kind: "message", msg });
      }
      i = j;
    } else {
      items.push({ kind: "message", msg });
      i++;
    }
  }
  return items;
}

interface ConversationViewProps {
  conversationId: string;
  canEdit: boolean;
  currentUserId: string;
  onBack: () => void;
  onClassificationChange: (id: string, classification: string) => void;
}

function ResetConversationButton({
  conversationId,
  onDone,
}: {
  conversationId: string;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (
      !confirm(
        "⚠ ATENÇÃO: isso vai APAGAR toda a conversa, mensagens, o lead vinculado e logs de automação deste contato. Útil pra testar welcome/follow-up do zero. Continuar?"
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/${conversationId}/reset`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Conversa resetada");
        onDone();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(`Falhou: ${data.error ?? "erro"}`);
      }
    } catch (e) {
      toast.error(`Falhou: ${e instanceof Error ? e.message : "rede"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleReset}
      disabled={loading}
      title="Resetar conversa (apaga mensagens, lead e logs)"
      className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-destructive border border-border hover:border-destructive/50 rounded-lg hover:bg-destructive/5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
      Reset
    </button>
  );
}

export function ConversationView({ conversationId, canEdit, currentUserId, onBack, onClassificationChange }: ConversationViewProps) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [linkedLead, setLinkedLead] = useState<LinkedLead | null>(null);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkingLead, setLinkingLead] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; content: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; type: "image" | "video"; alt?: string } | null>(null);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [recordingActive, setRecordingActive] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState("");
  const [quickTaskOpen, setQuickTaskOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);

  const displayItems = useMemo(() => groupMessages(messages), [messages]);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setConversation(data.conversation);
        setMessages(data.messages);
        if (data.linkedLead) setLinkedLead(data.linkedLead);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [conversationId]);

  const handleCreateLead = async () => {
    setLinkingLead(true);
    try {
      const res = await fetch(`/api/crm/${conversationId}/link-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createNew: true }),
      });
      if (res.ok) {
        toast.success("Lead criado!");
        fetchMessages();
      } else {
        toast.error("Erro ao criar lead");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setLinkingLead(false);
    }
  };

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Auto-scroll: SÓ desce se o usuário JÁ estava no fim. Se ele rolou pra cima
  // pra ler mensagens antigas, NÃO força descida quando chegam novas msgs ou
  // quando mídia (sticker/imagem/video) termina de carregar e dispara reflow.
  useEffect(() => {
    if (wasAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Scroll listener — atualiza wasAtBottomRef + mostra botão "descer"
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const distance = scrollHeight - scrollTop - clientHeight;
      const atBottom = distance < 80;
      wasAtBottomRef.current = atBottom;
      setShowScrollDown(!atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // estado inicial
    return () => el.removeEventListener("scroll", onScroll);
  }, [conversationId]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    wasAtBottomRef.current = true;
    setShowScrollDown(false);
  }, []);

  const handleSend = async () => {
    const hasText = inputText.trim().length > 0;
    const hasFiles = stagedFiles.length > 0;
    if ((!hasText && !hasFiles) || sending) return;
    setSending(true);
    try {
      const newMessages: Message[] = [];

      // Send each staged file
      for (const f of stagedFiles) {
        const res = await fetch(`/api/crm/${conversationId}/send-media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: f.dataUri, fileName: f.fileName, isImage: f.isImage }),
        });
        if (res.ok) {
          const data = await res.json();
          newMessages.push(data.message);
        }
      }

      // Send text message if present
      if (hasText) {
        const res = await fetch(`/api/crm/${conversationId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: inputText.trim(), quotedMessageId: replyTo?.id }),
        });
        if (res.ok) {
          const data = await res.json();
          newMessages.push(data.message);
        }
      }

      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const unique = newMessages.filter((m) => !ids.has(m.id));
        return unique.length === 0 ? prev : [...prev, ...unique];
      });
      setInputText("");
      setStagedFiles([]);
      setReplyTo(null);
    } catch { /* silent */ }
    finally { setSending(false); }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    const staged = await Promise.all(
      files.map(
        (f) =>
          new Promise<StagedFile>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                localId: Math.random().toString(36).slice(2),
                dataUri: reader.result as string,
                fileName: f.name,
                isImage: f.type.startsWith("image/"),
              });
            reader.onerror = reject;
            reader.readAsDataURL(f);
          })
      )
    );

    setStagedFiles((prev) => [...prev, ...staged]);
  };

  const removeStagedFile = (localId: string) =>
    setStagedFiles((prev) => prev.filter((f) => f.localId !== localId));

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imageItems = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const staged = await Promise.all(
      imageItems.map(
        (item) =>
          new Promise<StagedFile | null>((resolve) => {
            const file = item.getAsFile();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                localId: Math.random().toString(36).slice(2),
                dataUri: reader.result as string,
                fileName: `imagem-${Date.now()}.png`,
                isImage: true,
              });
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          })
      )
    );
    const valid = staged.filter(Boolean) as StagedFile[];
    if (valid.length > 0) setStagedFiles((prev) => [...prev, ...valid]);
  };

  const toggleStar = async (msgId: string, current: boolean) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isStarred: !current } : m));
    await fetch(`/api/crm/${conversationId}/messages/${msgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isStarred: !current }),
    });
  };

  const saveAs = (msg: Message) => {
    if (msg.mediaType === "audio" || msg.mediaType === "image" || msg.mediaType === "video") {
      const a = document.createElement("a");
      a.href = `/api/crm/${conversationId}/messages/${msg.id}/media`;
      a.download = `${msg.mediaType}-${msg.id}`;
      a.click();
    } else if (msg.content) {
      const blob = new Blob([msg.content], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mensagem-${msg.id}.txt`;
      a.click();
    }
  };

  const handleClassificationChange = async (value: string) => {
    await fetch(`/api/crm/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classification: value }),
    });
    setConversation((prev) => prev ? { ...prev, classification: value } : prev);
    onClassificationChange(conversationId, value);
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Excluir ${ids.length} mensagem${ids.length !== 1 ? "s" : ""}? Isso é permanente.`)) {
      return;
    }
    // Otimista: remove do estado local primeiro
    setMessages((prev) => prev.filter((m) => !selected.has(m.id)));
    setSelected(new Set());
    setSelectMode(false);

    // DELETE em paralelo
    const results = await Promise.allSettled(
      ids.map((msgId) =>
        fetch(`/api/crm/${conversationId}/messages/${msgId}`, { method: "DELETE" })
      )
    );
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
    if (failed.length > 0) {
      toast.error(`${failed.length} mensagem(ns) não foram excluídas. Atualizando…`);
      fetchMessages(); // refetch pra reconciliar
    } else {
      toast.success(`${ids.length} mensagem${ids.length !== 1 ? "s" : ""} excluída${ids.length !== 1 ? "s" : ""}`);
    }
  };

  const saveAlias = async () => {
    setEditingAlias(false);
    const alias = aliasInput.trim() || null;
    setConversation((prev) => prev ? { ...prev, contactAlias: alias } : prev);
    await fetch(`/api/crm/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactAlias: alias }),
    });
  };

  const name = conversation?.contactAlias ?? conversation?.contactName ?? conversation?.contactPushName ?? conversation?.contactPhone ?? "...";

  const renderMessageContent = (msg: Message, isOutgoing: boolean) => {
    // Otimização: se mediaUrl já é URL pública (Supabase Storage), usa direto
    // pra evitar round-trip do proxy /api/crm/.../messages/.../media (que faz
    // auth + DB lookup + 302 redirect — adiciona ~1s de latência).
    const mediaSrc =
      msg.mediaUrl && msg.mediaUrl.startsWith("http")
        ? msg.mediaUrl
        : `/api/crm/${conversationId}/messages/${msg.id}/media`;

    if (msg.mediaType === "audio") {
      return <AudioPlayer src={mediaSrc} isOutgoing={isOutgoing} />;
    }
    if (msg.mediaType === "sticker") {
      return <StickerView src={mediaSrc} />;
    }
    if (msg.mediaType === "video") {
      return (
        <video
          src={mediaSrc}
          controls
          preload="metadata"
          className="max-w-[260px] rounded-lg cursor-pointer"
          onClick={(e) => {
            // Click sem play (se já estiver tocando, controls cuidam) abre lightbox
            const v = e.currentTarget;
            if (v.paused) {
              setLightbox({ src: mediaSrc, type: "video", alt: "Vídeo" });
            }
          }}
        />
      );
    }
    if (msg.mediaType === "image") {
      return (
        <img
          src={mediaSrc}
          alt="imagem"
          className="max-w-[220px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => setLightbox({ src: mediaSrc, type: "image", alt: "Imagem" })}
          draggable={false}
        />
      );
    }
    if (msg.mediaType === "document") {
      return (
        <a
          href={`/api/crm/${conversationId}/messages/${msg.id}/media`}
          download={msg.content ?? "arquivo"}
          className={cn("flex items-center gap-2 py-0.5 hover:opacity-80 transition-opacity", isOutgoing ? "text-white" : "text-foreground")}
        >
          <FileText className="w-5 h-5 shrink-0 opacity-70" />
          <span className="text-xs truncate max-w-[160px]">{msg.content ?? "Documento"}</span>
          <Download className="w-3.5 h-3.5 shrink-0 opacity-60" />
        </a>
      );
    }
    if (msg.content) {
      return <p className="whitespace-pre-wrap break-words">{msg.content}</p>;
    }
    // Fallback: mensagem sem conteúdo nem mídia conhecida.
    // Os tipos audio/image/document já foram resolvidos acima — chegamos aqui
    // só se o webhook gravou mediaType desconhecido (ex: video sem URL ainda)
    // ou um tipo novo que não suportamos. Mostramos rótulo coerente com o tipo.
    return (
      <p className="italic opacity-70">
        {msg.mediaType === "video"
          ? "🎥 Vídeo"
          : msg.mediaType === "audio"
            ? "🎤 Áudio (mídia indisponível)"
            : msg.mediaType === "image"
              ? "📷 Imagem (mídia indisponível)"
              : msg.mediaType === "sticker"
                ? "🧩 Figurinha (mídia indisponível)"
                : msg.mediaType === "document"
                  ? "📄 Documento"
                  : "💬 Mensagem"}
      </p>
    );
  };

  const renderSingleMessage = (msg: Message) => {
    const isOutgoing = msg.direction === "outgoing";
    const msgLabel = msg.content ?? (msg.mediaType === "audio" ? "🎤 Áudio" : msg.mediaType === "image" ? "📷 Imagem" : msg.mediaType === "video" ? "🎥 Vídeo" : "Mensagem");
    const isSelected = selected.has(msg.id);

    const menuActions: MenuAction[] = [
      { label: "Responder", icon: <CornerUpLeft className="w-3.5 h-3.5" />, onClick: () => setReplyTo({ id: msg.id, content: msgLabel }) },
      ...(msg.content ? [{ label: "Copiar", icon: <Copy className="w-3.5 h-3.5" />, onClick: () => navigator.clipboard.writeText(msg.content!) }] : []),
      { label: msg.isStarred ? "Desfavoritar" : "Favoritar", icon: <Star className={cn("w-3.5 h-3.5", msg.isStarred && "fill-current text-warning")} />, onClick: () => toggleStar(msg.id, msg.isStarred) },
      { label: "Selecionar", icon: <CheckSquare className="w-3.5 h-3.5" />, onClick: () => { setSelectMode(true); setSelected((prev) => new Set([...prev, msg.id])); } },
      { label: "Salvar como", icon: <Download className="w-3.5 h-3.5" />, onClick: () => saveAs(msg) },
    ];

    return (
      <div
        key={msg.id}
        className={cn("group flex items-end gap-1", isOutgoing ? "justify-end" : "justify-start")}
        onClick={() => selectMode && setSelected((prev) => { const n = new Set(prev); n.has(msg.id) ? n.delete(msg.id) : n.add(msg.id); return n; })}
      >
        {selectMode && (
          <div className={cn("shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center", isSelected ? "bg-primary border-primary" : "border-muted")}>
            {isSelected && <div className="w-2 h-2 bg-white rounded-sm" />}
          </div>
        )}
        <div className={cn(
          "relative max-w-[75%] rounded-xl pl-3 pr-7 py-2 text-sm transition-colors",
          isOutgoing ? "bg-primary text-white rounded-br-sm" : "bg-surface-2 text-foreground rounded-bl-sm",
          isSelected && "ring-2 ring-primary"
        )}>
          {!selectMode && <div className="absolute top-1 right-1"><MessageMenu actions={menuActions} isOutgoing={isOutgoing} /></div>}
          {!isOutgoing && msg.senderName && (
            <p className="text-xs font-semibold text-primary mb-0.5">{msg.senderName}</p>
          )}
          {msg.quotedContent && (
            <div className={cn("text-xs px-2 py-1 rounded-lg mb-1.5 border-l-2", isOutgoing ? "bg-white/10 border-white/50" : "bg-black/5 border-primary")}>
              <p className="opacity-70 truncate">{msg.quotedContent}</p>
            </div>
          )}
          {renderMessageContent(msg, isOutgoing)}
          <div className="flex items-center gap-1 mt-1 justify-end">
            {msg.isStarred && <Star className="w-2.5 h-2.5 fill-current text-warning opacity-80" />}
            <p className={cn("text-[10px]", isOutgoing ? "text-white/70" : "text-muted")}>
              {format(new Date(msg.timestamp), "HH:mm")}
              {isOutgoing && msg.status && <span className="ml-1 opacity-70">· {msg.status}</span>}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderAlbum = (item: { kind: "album"; messages: Message[]; direction: string }) => {
    const isOutgoing = item.direction === "outgoing";
    const last = item.messages[item.messages.length - 1];
    return (
      <div
        key={item.messages[0].id}
        className={cn("group flex items-end gap-1", isOutgoing ? "justify-end" : "justify-start")}
      >
        <div className={cn(
          "relative rounded-xl overflow-hidden p-1 text-sm",
          isOutgoing ? "bg-primary text-white rounded-br-sm" : "bg-surface-2 text-foreground rounded-bl-sm"
        )}>
          <ImageGallery
            images={item.messages}
            conversationId={conversationId}
            isOutgoing={isOutgoing}
            onImageClick={(src) => setLightbox({ src, type: "image", alt: "Imagem" })}
          />
          <div className="flex items-center gap-1 mt-1 justify-end px-1">
            <p className={cn("text-[10px]", isOutgoing ? "text-white/70" : "text-muted")}>
              {format(new Date(last.timestamp), "HH:mm")}
              {isOutgoing && last.status && <span className="ml-1 opacity-70">· {last.status}</span>}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] bg-surface rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <button onClick={onBack} className="p-1.5 rounded text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
        </button>
        {conversation?.contactJid?.endsWith("@g.us") ? (
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 text-primary" />
          </div>
        ) : conversation?.contactProfilePicUrl?.startsWith("http") ? (
          <img src={conversation.contactProfilePicUrl} alt={name} className="w-8 h-8 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">{name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {editingAlias ? (
            <input
              ref={aliasInputRef}
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              onBlur={saveAlias}
              onKeyDown={(e) => { if (e.key === "Enter") saveAlias(); if (e.key === "Escape") setEditingAlias(false); }}
              placeholder={conversation?.contactName ?? conversation?.contactPushName ?? conversation?.contactPhone ?? "Apelido..."}
              className="w-full bg-surface-2 border border-primary rounded px-2 py-0.5 text-sm text-foreground focus:outline-none"
              autoFocus
            />
          ) : (
            <button
              onClick={() => { setAliasInput(conversation?.contactAlias ?? ""); setEditingAlias(true); setTimeout(() => aliasInputRef.current?.focus(), 0); }}
              className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors cursor-pointer text-left w-full"
              title="Clique para adicionar apelido"
            >
              {name}
            </button>
          )}
          <p className="text-small text-muted">{conversation?.contactJid?.includes("@lid") ? "WhatsApp" : conversation?.contactPhone}</p>
          {linkedLead?.nextFollowUp && (
            <NextFollowUpBadge data={linkedLead.nextFollowUp} variant="full" className="mt-0.5" />
          )}
        </div>
        {linkedLead ? (
          <>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 rounded-lg shrink-0">
              <GitBranch className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">{linkedLead.name}</span>
              {linkedLead.stageName && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${linkedLead.stageColor ?? "#6C5CE7"}20`, color: linkedLead.stageColor ?? "#6C5CE7" }}>
                  {linkedLead.stageName}
                </span>
              )}
            </div>
            {canEdit && (
              <button
                onClick={() => setQuickTaskOpen(true)}
                title="Criar tarefa pra esse lead"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-foreground border border-border rounded-lg hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
              >
                <ListTodo className="w-3.5 h-3.5" />
                Tarefa
              </button>
            )}
          </>
        ) : canEdit && conversation && (
          <button onClick={handleCreateLead} disabled={linkingLead} className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-foreground border border-border rounded-lg hover:bg-surface-2 transition-colors cursor-pointer shrink-0">
            {linkingLead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
            Criar Lead
          </button>
        )}
        {canEdit && conversation && (
          <div className="flex items-center gap-2 shrink-0">
            <Tag className="w-4 h-4 text-muted" />
            <select value={conversation.classification} onChange={(e) => handleClassificationChange(e.target.value)} className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary transition-colors cursor-pointer">
              {CLASSIFICATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        {canEdit && conversation && <ResetConversationButton conversationId={conversationId} onDone={onBack} />}
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={messagesContainerRef} className="absolute inset-0 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
          ) : displayItems.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">Nenhuma mensagem ainda</div>
          ) : (
            displayItems.map((item) =>
              item.kind === "album"
                ? renderAlbum(item)
                : renderSingleMessage(item.msg)
            )
          )}
          <div ref={bottomRef} />
        </div>

        {/* Botão flutuante "descer" — aparece quando user rolou pra cima */}
        {showScrollDown && (
          <button
            onClick={scrollToBottom}
            aria-label="Descer pro fim da conversa"
            title="Descer"
            className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-surface border border-border shadow-lg text-foreground hover:bg-surface-2 transition-colors cursor-pointer flex items-center justify-center"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Selection toolbar */}
      {selectMode && (
        <div className="border-t border-border px-4 py-2.5 flex items-center gap-2 shrink-0 bg-surface-2">
          <span className="text-sm text-foreground font-medium flex-1">
            {selected.size} selecionada{selected.size !== 1 ? "s" : ""}
          </span>
          {selected.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 text-xs text-error hover:bg-error/10 px-3 py-1.5 rounded-lg border border-error/30 transition-colors cursor-pointer"
              title="Excluir selecionadas"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir
            </button>
          )}
          <button
            onClick={() => { setSelectMode(false); setSelected(new Set()); }}
            className="text-xs text-muted hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-surface transition-colors cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Input */}
      {canEdit && !selectMode && (
        <div className="border-t border-border shrink-0">
          {/* Staged files preview */}
          {stagedFiles.length > 0 && (
            <div className="flex gap-2 px-3 pt-2 pb-1 overflow-x-auto">
              {stagedFiles.map((f) => (
                <div key={f.localId} className="relative shrink-0">
                  {f.isImage ? (
                    <img src={f.dataUri} alt={f.fileName} className="w-16 h-16 object-cover rounded-lg border border-border" />
                  ) : (
                    <div className="w-16 h-16 bg-surface-2 border border-border rounded-lg flex flex-col items-center justify-center gap-1 px-1">
                      <FileText className="w-5 h-5 text-muted" />
                      <span className="text-[9px] text-muted truncate w-full text-center">{f.fileName}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeStagedFile(f.localId)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-error text-white rounded-full flex items-center justify-center hover:opacity-80 transition-opacity"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Reply banner */}
          {replyTo && (
            <div className="flex items-center gap-2 px-3 pt-2 pb-1">
              <div className="flex-1 flex items-center gap-2 bg-surface-2 rounded-lg px-2 py-1 border-l-2 border-primary">
                <CornerUpLeft className="w-3 h-3 text-primary shrink-0" />
                <p className="text-xs text-muted truncate">{replyTo.content}</p>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-muted hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="p-3 flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
              className="hidden"
              onChange={handleFileSelect}
            />
            {!recordingActive && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className="p-2.5 text-muted hover:text-foreground hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
                title="Anexar arquivo"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            <AudioRecorder
              conversationId={conversationId}
              disabled={sending}
              onActiveChange={setRecordingActive}
              onSent={(message) => {
                setMessages((prev) => {
                  const m = message as Message;
                  if (prev.some((p) => p.id === m.id)) return prev;
                  return [...prev, m];
                });
              }}
            />
            {!recordingActive && (
              <>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  onPaste={handlePaste}
                  placeholder={stagedFiles.length > 0 ? "Adicionar legenda... (Enter para enviar)" : "Digite uma mensagem... (Ctrl+V para colar imagem)"}
                  rows={1}
                  className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary transition-colors resize-none max-h-32"
                  style={{ overflowY: "auto" }}
                />
                <button
                  onClick={handleSend}
                  disabled={(!inputText.trim() && stagedFiles.length === 0) || sending}
                  className="p-2.5 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <MediaLightbox
        src={lightbox?.src ?? null}
        type={lightbox?.type ?? "image"}
        alt={lightbox?.alt}
        onClose={() => setLightbox(null)}
      />

      {linkedLead && (
        <QuickTaskModal
          open={quickTaskOpen}
          onClose={() => setQuickTaskOpen(false)}
          leadId={linkedLead.id}
          leadName={linkedLead.name}
          currentUserId={currentUserId}
          onCreated={() => {
            // Trigger refresh do badge "próxima tarefa" se existir.
            // O page recarregará linkedLead.nextFollowUp na próxima fetch.
          }}
        />
      )}
    </div>
  );
}
