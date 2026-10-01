import { useMemo } from 'react'

import { formatValue } from '../format'
import { buildTable, thresholdColor } from '../table'

import type { ValueColumn } from '../table'
import type { DataFrame, Panel } from '../types'

type Props = {
  frames: DataFrame[]
  panel: Panel
}

// Grafana "table" panel for instant Prometheus queries. The data shaping
// (merge / organize transformations, fieldConfig overrides) lives in
// ../table.ts.
export function TablePanel({ frames, panel }: Props) {
  const model = useMemo(() => buildTable(frames, panel), [frames, panel])

  if (model.rows.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No data
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-auto scrollbar-thin">
      <table className="w-full text-[11.5px] border-collapse">
        <thead className="sticky top-0 bg-zGray-925 z-10">
          <tr>
            {model.labelColumns.map((c) => (
              <th
                key={c}
                className="text-left font-medium text-tertiary px-3 py-1.5 border-b border-zGray-800/60 whitespace-nowrap"
              >
                {model.labelTitles[c] ?? c}
              </th>
            ))}
            {model.valueColumns.map((c) => (
              <th
                key={c.key}
                className="text-right font-medium text-tertiary px-3 py-1.5 border-b border-zGray-800/60 whitespace-nowrap"
              >
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, i) => (
            <tr key={i} className="hover:bg-zGray-900/60">
              {model.labelColumns.map((c) => (
                <td
                  key={c}
                  className="px-3 py-1 text-secondary border-b border-zGray-850/60 max-w-[280px] truncate"
                  title={row.labels[c] ?? ''}
                >
                  {row.labels[c] ?? ''}
                </td>
              ))}
              {model.valueColumns.map((c) => {
                const v = row.values[c.key] ?? null
                const bg = c.colorBackground ? thresholdColor(v, c.thresholds) : null

                return (
                  <td
                    key={c.key}
                    className="px-3 py-1 text-right font-mono text-main border-b border-zGray-850/60 whitespace-nowrap"
                    style={bg ? { backgroundColor: withAlpha(bg, 0.22) } : undefined}
                  >
                    {formatCell(v, c)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatCell(v: number | null, col: ValueColumn): string {
  if (v == null) return '—'
  if (col.decimals != null) {
    if (col.unit === 'percentunit') return `${(v * 100).toFixed(col.decimals)}%`
    if (col.unit === 'ms') return `${v.toFixed(col.decimals)} ms`
    if (col.unit === 'reqps') return `${v.toFixed(col.decimals)} req/s`

    return v.toFixed(col.decimals)
  }

  return formatValue(v, col.unit)
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)

  if (!m) {
    // Custom threshold colors (named, rgb(...), short hex) still get faded.
    return `color-mix(in srgb, ${color} ${String(Math.round(alpha * 100))}%, transparent)`
  }
  const n = parseInt(m[1], 16)

  return `rgba(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)}, ${String(alpha)})`
}
