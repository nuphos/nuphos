// Pulsing placeholder rows the same height as real table rows, so a loading
// list doesn't flash an empty layout before data arrives.
export function TableSkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[30px] items-center gap-3 border-b border-zGray-850 px-2">
          <div className="h-3 w-16 rounded bg-zGray-850" />
          <div className="h-3 w-48 rounded bg-zGray-850" />
          <div className="h-3 w-24 rounded bg-zGray-850" />
          <div className="h-3 w-14 rounded bg-zGray-850" />
          <div className="h-3 w-56 rounded bg-zGray-850" />
          <div className="h-3 w-20 rounded bg-zGray-850" />
        </div>
      ))}
    </div>
  )
}

// Cold-start variant with a column-header bar, for pages that skip mounting
// the real Table until data exists (e.g. Monitoring's no-cache first load).
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      <div className="flex h-8 animate-pulse items-center gap-3 border-b border-zGray-800 px-2">
        {[110, 280, 170, 100, 320, 140].map((w, i) => (
          <div key={i} className="h-3 rounded bg-zGray-800" style={{ width: w * 0.6 }} />
        ))}
      </div>
      <TableSkeletonRows rows={rows} />
    </div>
  )
}
