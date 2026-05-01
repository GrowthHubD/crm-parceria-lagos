export default function CrmLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-20 rounded-lg bg-surface-2" />
        <div className="h-4 w-52 rounded bg-surface-2/60" />
      </div>
      <div className="flex gap-4 h-[calc(100vh-200px)]">
        {/* Lista de conversas */}
        <div className="w-80 flex-shrink-0 space-y-2">
          <div className="h-10 rounded-lg bg-surface-2" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-surface-2/80 border border-border" />
          ))}
        </div>
        {/* Área de conversa */}
        <div className="flex-1 rounded-xl bg-surface-2/40 border border-border" />
      </div>
    </div>
  );
}
