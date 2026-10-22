const SKELETON = 'animate-pulse rounded bg-zGray-800/50 motion-reduce:animate-none'

/** The heatmap card's shape while its history loads, so the table does not jump. */
export function HeatmapSkeleton({ rows }: { rows: number }) {
  return (
    <div
      aria-hidden="true"
      className="mb-4 rounded-xl border border-zGray-800/60 bg-surface/40 px-4 pb-3 pt-3"
    >
      <div className={`mb-4 h-3.5 w-48 ${SKELETON}`} />
      <div className="space-y-2">
        {Array.from({ length: Math.max(rows, 3) }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`h-3 w-28 shrink-0 @3xl:w-40 ${SKELETON}`} />
            <div className={`h-3 min-w-0 flex-1 ${SKELETON}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The whole overview's shape before the agents themselves have loaded. */
export function AgentUsageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading runtimes">
      <div className={`mb-2 h-3 w-36 ${SKELETON}`} />
      <div className={`mb-4 h-3 w-64 ${SKELETON}`} />
      <HeatmapSkeleton rows={5} />
      <div aria-hidden="true" className="rounded-xl border border-zGray-800/60 bg-surface/40">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-zGray-800/60 px-4 py-3 last:border-b-0"
          >
            <div className={`h-8 w-8 shrink-0 rounded-lg ${SKELETON}`} />
            <div className={`h-3 w-40 ${SKELETON}`} />
            <div className={`ml-auto h-1.5 w-48 ${SKELETON}`} />
          </div>
        ))}
      </div>
    </div>
  )
}
