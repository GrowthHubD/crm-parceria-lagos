export default function KanbanLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-40 rounded-lg bg-surface-2" />
        <div className="h-4 w-60 rounded bg-surface-2/60" />
      </div>
      <div className="flex gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-shrink-0 w-64 space-y-3">
            <div className="h-8 rounded-lg bg-surface-2" />
            {[0, 1].map((j) => (
              <div key={j} className="h-20 rounded-xl bg-surface-2/80 border border-border" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
