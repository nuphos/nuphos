// Grafana's standard quick ranges (the relative subset our resolver supports).
export const QUICK_RANGES: { from: string; label: string }[] = [
  { from: 'now-5m', label: 'Last 5 minutes' },
  { from: 'now-15m', label: 'Last 15 minutes' },
  { from: 'now-30m', label: 'Last 30 minutes' },
  { from: 'now-1h', label: 'Last 1 hour' },
  { from: 'now-3h', label: 'Last 3 hours' },
  { from: 'now-6h', label: 'Last 6 hours' },
  { from: 'now-12h', label: 'Last 12 hours' },
  { from: 'now-24h', label: 'Last 24 hours' },
  { from: 'now-2d', label: 'Last 2 days' },
  { from: 'now-7d', label: 'Last 7 days' },
  { from: 'now-30d', label: 'Last 30 days' },
  { from: 'now-90d', label: 'Last 90 days' },
]

export type TimeSel =
  { kind: 'relative'; from: string } | { kind: 'absolute'; from: number; to: number }

// Seed the time selection from the dashboard's saved range: any parseable
// relative (`now-2h` works even off the quick list), absolute epoch-ms or ISO
// endpoints, and only then the Last-1h fallback.
export function initialTimeSel(from: string, to: string): TimeSel {
  if (/^now-\d+[smhdw]$/.test(from) && to === 'now') {
    return { kind: 'relative', from }
  }
  const f = parseAbsoluteTime(from)
  const t = parseAbsoluteTime(to)

  if (f != null && t != null && f < t) return { kind: 'absolute', from: f, to: t }

  return { kind: 'relative', from: 'now-1h' }
}

function parseAbsoluteTime(s: string): number | null {
  const n = Number(s)

  if (Number.isFinite(n)) return n
  const parsed = Date.parse(s)

  return Number.isFinite(parsed) ? parsed : null
}

export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => (n < 10 ? `0${String(n)}` : String(n))

  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatAbsolute(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => (n < 10 ? `0${String(n)}` : String(n))

  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function timeSelLabel(sel: TimeSel): string {
  if (sel.kind === 'relative') {
    return QUICK_RANGES.find((r) => r.from === sel.from)?.label ?? sel.from
  }

  return `${formatAbsolute(sel.from)} → ${formatAbsolute(sel.to)}`
}
