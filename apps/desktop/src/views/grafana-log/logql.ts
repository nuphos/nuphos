export type LabelFilter = {
  id: number
  name: string
  value: string
}

export const RANGE_OPTIONS = [
  { label: '15m', ms: 15 * 60_000 },
  { label: '1h', ms: 60 * 60_000 },
  { label: '6h', ms: 6 * 60 * 60_000 },
  { label: '24h', ms: 24 * 60 * 60_000 },
]

export const LIVE_TAIL_INTERVAL_MS = 5_000

// The loki skill pins {env, instance, service} as the fleet-wide label
// convention — surface those first so the default filter matches how the
// agent onboards machines.
export const PREFERRED_LABELS = ['service', 'instance', 'env']

export function getWindowMs(rangeMs: number) {
  const endMs = Date.now()

  return { startMs: endMs - rangeMs, endMs }
}

// The keyword lands inside a LogQL line-filter string: |= "…".
function escapeLogQlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Loki rejects a fully-empty selector by design (no unindexed full scans), so
// a label with no chosen value becomes `label=~".+"` — "streams that have this
// label, any value". With the auto-seeded label this makes a plain Run work
// with zero input, the closest Loki allows to an empty query.
export function buildExpr(filters: LabelFilter[], keyword: string): string | null {
  const matchers = filters
    .filter((f) => f.name)
    .map((f) => (f.value ? `${f.name}="${escapeLogQlString(f.value)}"` : `${f.name}=~".+"`))

  if (matchers.length === 0) return null
  const kw = keyword.trim()
  const keywordFilter = kw ? ` |= "${escapeLogQlString(kw)}"` : ''

  return `{${matchers.join(', ')}}${keywordFilter}`
}
