export default function TasksLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-32 rounded-lg bg-surface-2" />
          <div className="h-4 w-48 rounded bg-surface-2/60" />
        </div>
        <div className="h-9 w-32 rounded-lg bg-surface-2" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 rounded-xl bg-surface-2/80 border border-border" />
        ))}
      </div>
    </div>
  );
}
