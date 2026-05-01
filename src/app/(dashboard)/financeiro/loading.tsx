export default function FinanceiroLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-40 rounded-lg bg-surface-2" />
        <div className="h-4 w-56 rounded bg-surface-2/60" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-surface-2 border border-border" />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-surface-2/80 border border-border" />
        ))}
      </div>
    </div>
  );
}
