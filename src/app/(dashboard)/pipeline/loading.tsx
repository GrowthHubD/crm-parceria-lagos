export default function PipelineLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-36 rounded-lg bg-surface-2" />
        <div className="h-4 w-56 rounded bg-surface-2/60" />
      </div>
      <div className="flex gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-shrink-0 w-72 space-y-3">
            <div className="h-8 rounded-lg bg-surface-2" />
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-24 rounded-xl bg-surface-2/80 border border-border" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
