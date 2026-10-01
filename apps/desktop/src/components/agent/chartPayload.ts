type ChartType = 'area' | 'bar' | 'line'

type SeriesSpec = {
  key: string
  label?: string
}

export type ChartPayload = {
  type: ChartType
  title: string
  description?: string
  xKey: string
  series: SeriesSpec[]
  data: Record<string, string | number | null>[]
  /** Stack the series (area/bar) so they read as a whole-and-parts composition
   *  — e.g. total spend split by account — instead of independent overlays. */
  stacked?: boolean
}

function isValidPayload(input: unknown): input is ChartPayload {
  if (!input || typeof input !== 'object') return false
  const o = input as Record<string, unknown>

  if (o.type !== 'area' && o.type !== 'bar' && o.type !== 'line') return false
  if (typeof o.title !== 'string') return false
  const xKey = o.xKey

  if (typeof xKey !== 'string' || xKey.length === 0) return false
  if (!Array.isArray(o.series) || o.series.length === 0) return false
  if (!Array.isArray(o.data) || o.data.length === 0) return false

  const seriesOk = o.series.every(
    (s) =>
      s &&
      typeof s === 'object' &&
      typeof (s as { key?: unknown }).key === 'string' &&
      (s as { key: string }).key.length > 0,
  )

  if (!seriesOk) return false

  // Every row must carry the xKey and a number/null for each declared series —
  // otherwise Recharts silently renders undefined as a flat zero, misleading
  // users into thinking they have real zero-valued data.
  const seriesKeys = (o.series as { key: string }[]).map((s) => s.key)

  return o.data.every((row) => {
    if (!row || typeof row !== 'object') return false
    const r = row as Record<string, unknown>

    if (!Object.prototype.hasOwnProperty.call(r, xKey)) return false

    return seriesKeys.every((key) => {
      const v = r[key]

      return typeof v === 'number' || v === null
    })
  })
}

export function tryParseChartPayload(value: unknown): ChartPayload | null {
  if (isValidPayload(value)) return value
  // Fallback for stringified payloads from tool output streaming.
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)

      if (isValidPayload(parsed)) return parsed
    } catch {
      // fall through
    }
  }

  return null
}
