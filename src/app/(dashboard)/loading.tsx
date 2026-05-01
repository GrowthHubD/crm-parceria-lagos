/**
 * Loading boundary do (dashboard) — mostra skeleton instantâneo enquanto a
 * próxima página renderiza no servidor (queries DB + RSC). Sem isso, o browser
 * mantém a página anterior até o novo conteúdo chegar, gerando "delay percebido"
 * de 100-1000ms na troca de aba mesmo com queries rápidas.
 *
 * Mantém a sidebar/topbar visíveis (preservadas pelo layout) — só substitui o
 * conteúdo principal por skeleton.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-48 rounded-lg bg-surface-2" />
        <div className="h-4 w-72 rounded bg-surface-2/60" />
      </div>

      {/* Cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-surface-2 border border-border" />
        ))}
      </div>

      {/* Content block */}
      <div className="space-y-3">
        <div className="h-12 w-full rounded-lg bg-surface-2" />
        <div className="h-12 w-full rounded-lg bg-surface-2/80" />
        <div className="h-12 w-full rounded-lg bg-surface-2/60" />
        <div className="h-12 w-full rounded-lg bg-surface-2/40" />
      </div>
    </div>
  );
}
