// Grafana-style value formatters. Covers the units we need for the demo
// dashboard; falls back to decimal-with-suffix for everything else.

export function formatValue(v: number | null | undefined, unit?: string): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const u = unit || ''

  switch (u) {
    case 'percentunit':
      return `${(v * 100).toFixed(2)}%`
    case 'percent':
      return `${v.toFixed(2)}%`
    case 'decbytes':
    case 'bytes':
      return formatBytes(v)
    case 'reqps':
      return `${formatNumber(v)} req/s`
    case 's':
      return `${formatNumber(v)}s`
    case 'ms':
      return `${formatNumber(v)} ms`
    default:
      return formatNumber(v)
  }
}

export function formatBytes(v: number): string {
  const abs = Math.abs(v)

  if (abs < 1024) return `${v.toFixed(0)} B`
  if (abs < 1024 ** 2) return `${(v / 1024).toFixed(2)} KiB`
  if (abs < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(2)} MiB`
  if (abs < 1024 ** 4) return `${(v / 1024 ** 3).toFixed(2)} GiB`

  return `${(v / 1024 ** 4).toFixed(2)} TiB`
}

export function formatNumber(v: number): string {
  const abs = Math.abs(v)

  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}k`
  if (abs >= 1) return v.toFixed(2)
  if (abs === 0) return '0'

  return v.toPrecision(3)
}

export function formatTime(ms: number, span?: number): string {
  const d = new Date(ms)

  // For ranges over a day, show date.
  if (span && span > 86400_000) {
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function pad(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}

// Series colors — palette inspired by Grafana's classic, restricted to colors
// that read well on the Nuphos dark background.
const PALETTE = [
  '#73bf69',
  '#f2cc0c',
  '#8ab8ff',
  '#ff9830',
  '#fa6e6e',
  '#a78bfa',
  '#37c0a8',
  '#ffd866',
  '#5794f2',
  '#e4609b',
  '#67c9d4',
  '#b66dff',
]

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length]
}

// Render a series label from labels + an optional Grafana legend template
// (e.g., "{{pod}}" or "{{_msg}}").
export function renderLegend(
  labels: Record<string, string> | undefined,
  template: string | undefined,
  fallback: string,
): string {
  if (!labels) return template ? renderTemplate(template, {}, fallback) : fallback
  if (template && template !== '__auto') {
    return renderTemplate(template, labels, fallback)
  }
  // __auto / missing → "{k=v, k=v}" format that matches Grafana.
  const keys = Object.keys(labels).filter((k) => !k.startsWith('__'))

  if (keys.length === 0) return fallback
  const pairs = keys.map((k) => `${k}="${labels[k]}"`)

  return `{${pairs.join(', ')}}`
}

function renderTemplate(
  template: string,
  labels: Record<string, string>,
  fallback: string,
): string {
  const out = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => labels[k] ?? '')

  return out.trim() || fallback
}
