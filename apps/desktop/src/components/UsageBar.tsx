// Compact resource meter: absolute usage, continuous fill, and a request tick.
// A limit/capacity defines the full track. Without one, leave headroom beyond
// the request; with neither a request nor capacity, show only the usage value.
type Props = {
  used: number | null
  requested: number | null
  capacity: number | null
  format: (n: number | null) => string
  noCapacityLabel?: string
  resource?: 'cpu' | 'memory'
}

export function UsageBar({
  used,
  requested,
  capacity,
  format,
  noCapacityLabel = 'no limit',
  resource = 'cpu',
}: Props) {
  const hasCapacity = capacity != null && capacity > 0
  const hasRequest = requested != null && requested > 0
  let scale = 0

  if (hasCapacity) scale = capacity
  else if (hasRequest) scale = Math.max(requested / 0.8, used ?? 0)
  const usedPercent = scale > 0 ? Math.min(100, Math.max(0, ((used ?? 0) / scale) * 100)) : 0
  const requestPercent = scale > 0 && hasRequest ? Math.min(100, (requested / scale) * 100) : null
  const overRequest = hasRequest && used != null && used > requested
  const overCapacity = hasCapacity && used != null && used > capacity
  // Color only the portion exceeding the reservation, so the meter still
  // shows how much usage is within budget. Capacity overrun colors the label.
  const budgetPercent =
    overRequest && used > 0 ? Math.min(100, (requested / Math.min(used, scale)) * 100) : 100
  const fill = `linear-gradient(to right, var(--resource-meter-fill) ${String(budgetPercent)}%, var(--resource-meter-warning) ${String(budgetPercent)}%)`
  const lines: string[] = [resource === 'cpu' ? 'CPU' : 'Memory']

  if (used != null) {
    lines.push(
      hasCapacity
        ? `used: ${format(used)} (${((used / capacity) * 100).toFixed(0)}%)`
        : `used: ${format(used)}`,
    )
  }
  if (requested != null) lines.push(`requested: ${format(requested)}`)
  lines.push(hasCapacity ? `capacity: ${format(capacity)}` : noCapacityLabel)

  return (
    <div className="resource-meter flex w-full items-center gap-2" title={lines.join('\n')}>
      <span
        className="w-[6ch] shrink-0 whitespace-nowrap text-[12.5px] tabular-nums text-main"
        style={overCapacity ? { color: 'var(--resource-meter-warning)' } : undefined}
      >
        {used != null ? format(used).replace(/ (Ki|Mi|Gi|Ti)$/, '$1') : '–'}
      </span>
      {scale > 0 && (
        <div
          className="resource-meter-track relative h-1.5 min-w-0 flex-1 rounded-full"
          aria-hidden="true"
        >
          {requestPercent != null && (
            <div
              className="resource-meter-reserved absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${String(requestPercent)}%` }}
            />
          )}
          <div
            className="relative h-full rounded-full"
            style={{ width: `${String(usedPercent)}%`, background: fill }}
          />
          {requestPercent != null && (
            <span
              className="resource-meter-request absolute -top-0.5 h-2.5 w-px -translate-x-1/2 rounded-full"
              style={{ left: `clamp(1px, ${String(requestPercent)}%, calc(100% - 1px))` }}
            />
          )}
        </div>
      )}
    </div>
  )
}
