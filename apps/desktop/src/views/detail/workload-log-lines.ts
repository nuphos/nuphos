import type { WorkloadLogLine } from '../../types'

// Aggregated log viewer — fans out per (pod, container), merges by
// timestamp, prefixes each line with `[pod/container]` so the source is
// obvious in a scrollback. One-shot fetch with a tail; users can hit
// Refresh to re-pull.
const POD_LOG_COLORS = [
  'text-zViolet-accent',
  'text-success',
  'text-warning',
  'text-zOrangered-500',
  'text-zViolet-400',
  'text-zGray-300',
]

// Rolling-window cap on the live log buffer. Picks the largest value that
// keeps re-render cost negligible on average hardware — past this the
// renderer process visibly slows on busy streams.
export const LOG_LINE_CAP = 5000

// Render-side row carries a monotonic id so it can be used as a stable
// React key. Without this, front-trimming the array would invalidate the
// identity of every retained row (key=index would map the new index to
// the wrong line).
export type LogRow = WorkloadLogLine & { id: number }

// Rolling-window cap + timestamp-stable merge. Each (pod, container) stream is
// delivered in arrival order, but a slower source can deliver older lines after
// newer ones — so we merge by RFC3339 timestamp to keep the combined log
// monotonic. Lines without a parsed timestamp (multi-line continuations)
// inherit their predecessor's order via the id tie-break.
export function mergeLogRows(prev: LogRow[], ingested: LogRow[]): LogRow[] {
  const merged = prev.concat(ingested)

  merged.sort((a, b) => {
    const at = a.timestamp ?? ''
    const bt = b.timestamp ?? ''

    if (at === bt) return a.id - b.id

    return at < bt ? -1 : 1
  })

  return merged.length > LOG_LINE_CAP ? merged.slice(merged.length - LOG_LINE_CAP) : merged
}

// Stable pod → color mapping. Built off the order pods first appeared in the
// stream so the same pod keeps the same color across re-renders.
export function buildPodColor(lines: LogRow[]): (pod: string) => string {
  const order = new Map<string, number>()

  for (const l of lines) {
    if (!order.has(l.pod)) order.set(l.pod, order.size)
  }

  return (pod: string) => POD_LOG_COLORS[(order.get(pod) ?? 0) % POD_LOG_COLORS.length]
}
