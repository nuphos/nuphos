import { formatValue } from '../../format'

import type { Series } from './types'

export function Legend({ series }: { series: Series[] }) {
  if (series.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-t border-zGray-800/60 max-h-20 overflow-y-auto scrollbar-thin">
      {series.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-tertiary min-w-0">
          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
          <span className="truncate" title={s.label}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Tooltip({
  x,
  y,
  ts,
  series,
  unit,
  width,
  height,
}: {
  x: number
  y: number
  ts: number
  series: Series[]
  unit?: string
  width: number
  height: number
}) {
  const rows = series
    .map((s) => ({ s, v: nearestValue(s.points, ts) }))
    .filter((r) => r.v != null)
    .sort((a, b) => b.v! - a.v!)
    .slice(0, 8)

  if (rows.length === 0) return null

  const tipW = 220
  const tipH = 22 + rows.length * 16
  const left = x + 12 + tipW > width ? x - tipW - 12 : x + 12
  const top = Math.min(Math.max(0, y - tipH / 2), height - tipH)

  return (
    <>
      <div
        className="absolute pointer-events-none"
        style={{
          left: x,
          top: 0,
          bottom: 0,
          width: 1,
          backgroundColor: 'rgba(var(--color-zGray-500), 0.4)',
        }}
      />
      <div
        className="absolute bg-zGray-850 border border-zGray-700 rounded shadow-lg px-2 py-1.5 text-[11px] pointer-events-none"
        style={{ left, top, width: tipW }}
      >
        <div className="text-tertiary mb-1">{new Date(ts).toLocaleTimeString()}</div>
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 min-w-0">
            <span
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: r.s.color }}
            />
            <span className="flex-1 truncate text-secondary" title={r.s.label}>
              {r.s.label}
            </span>
            <span className="text-main font-mono">{formatValue(r.v, unit)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function nearestValue(points: [number, number | null][], ts: number): number | null {
  if (points.length === 0) return null
  let best = 0
  let bestDiff = Infinity

  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i][0] - ts)

    if (d < bestDiff) {
      bestDiff = d
      best = i
    }
  }

  return points[best][1]
}
