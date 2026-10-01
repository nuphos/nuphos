import { useId, useMemo } from 'react'

import { formatTime, formatValue } from '../../format'
import { areaPointsForAxis, layoutTimeSeries } from '../../timeSeriesDisplay'

import { bounds, buildAreaPath, buildLinePath, niceTicks, timeBarWidth } from './geometry'

import type { Series } from './types'

export function Chart({
  series,
  unit,
  width,
  height,
  min,
  max,
  centeredZero,
  onHover,
}: {
  series: Series[]
  unit?: string
  width: number
  height: number
  min?: number
  max?: number
  centeredZero?: boolean
  onHover: (h: { x: number; y: number; ts: number } | null) => void
}) {
  const laidOut = useMemo(() => layoutTimeSeries(series), [series])
  const measured = useMemo(() => bounds(laidOut), [laidOut])
  const { tMin, tMax } = measured
  let vMin = min ?? measured.vMin
  let vMax = max ?? measured.vMax

  if (centeredZero && min === undefined && max === undefined) {
    const extent = Math.max(Math.abs(vMin), Math.abs(vMax))

    vMin = -extent
    vMax = extent
  }
  const gradientPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const gradientId = (id: string) => `${gradientPrefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  if (tMin === tMax || vMin === vMax) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No data
      </div>
    )
  }

  // Left padding follows the widest y label so long values ("999.99 req/s")
  // don't get clipped at the panel edge.
  const probeTicks = niceTicks(vMin, vMax, Math.max(2, Math.floor((height - 30) / 36)))
  const maxLabelLen = Math.max(...probeTicks.map((v) => formatValue(v, unit).length), 1)
  const padding = {
    top: 8,
    right: 12,
    bottom: 22,
    left: Math.min(96, Math.max(36, 10 + maxLabelLen * 6)),
  }
  const plotW = Math.max(0, width - padding.left - padding.right)
  const plotH = Math.max(0, height - padding.top - padding.bottom)

  const xScale = (t: number) => padding.left + ((t - tMin) / (tMax - tMin)) * plotW
  const yScale = (v: number) => padding.top + plotH - ((v - vMin) / (vMax - vMin)) * plotH

  const xTicks = niceTicks(tMin, tMax, Math.max(2, Math.floor(plotW / 90)))
  const yTicks = niceTicks(vMin, vMax, Math.max(2, Math.floor(plotH / 36)))
  const barWidth = timeBarWidth(laidOut, xScale, plotW)

  return (
    <svg
      width={width}
      height={height}
      className="absolute inset-0"
      onMouseMove={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        const x = e.clientX - rect.left

        if (x < padding.left || x > padding.left + plotW) {
          onHover(null)

          return
        }
        const ts = tMin + ((x - padding.left) / plotW) * (tMax - tMin)

        onHover({ x, y: e.clientY - rect.top, ts })
      }}
      onMouseLeave={() => onHover(null)}
    >
      <defs>
        {laidOut
          .filter(
            (item) => item.style.drawStyle === 'area' && item.style.gradientMode === 'opacity',
          )
          .map((item) => (
            <linearGradient
              key={`gradient-${item.id}`}
              id={gradientId(item.id)}
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="0"
              y1={padding.top}
              y2={padding.top + plotH}
            >
              <stop
                offset="0%"
                stopColor={item.color}
                stopOpacity={item.style.fillOpacity ?? 0.22}
              />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
      </defs>
      {/* y-axis grid + labels */}
      {yTicks.map((v) => {
        const y = yScale(v)

        return (
          <g key={`y-${String(v)}`}>
            <line
              x1={padding.left}
              x2={padding.left + plotW}
              y1={y}
              y2={y}
              stroke="rgba(var(--color-zGray-800), 0.6)"
              strokeWidth={1}
            />
            <text
              x={padding.left - 6}
              y={y + 3}
              textAnchor="end"
              fontSize={10}
              fill="rgb(var(--color-text-tertiary))"
            >
              {formatValue(v, unit)}
            </text>
          </g>
        )
      })}

      {/* x-axis labels */}
      {xTicks.map((t) => (
        <text
          key={`x-${String(t)}`}
          x={xScale(t)}
          y={height - padding.bottom + 14}
          textAnchor="middle"
          fontSize={10}
          fill="rgb(var(--color-text-tertiary))"
        >
          {formatTime(t, tMax - tMin)}
        </text>
      ))}

      {/* Stacked areas are painted first so lines and bars remain crisp. */}
      {laidOut
        .filter((series) => series.style.drawStyle === 'area')
        .map((series) => (
          <path
            key={`area-${series.id}`}
            d={buildAreaPath(
              areaPointsForAxis(series.renderPoints, vMin, Boolean(series.style.stack)),
              xScale,
              yScale,
            )}
            fill={
              series.style.gradientMode === 'opacity'
                ? `url(#${gradientId(series.id)})`
                : series.color
            }
            fillOpacity={
              series.style.gradientMode === 'opacity' ? 1 : (series.style.fillOpacity ?? 0.22)
            }
            stroke="none"
          />
        ))}

      {/* Cloud Monitoring STACKED_BAR is a time-series bar chart, not a
          categorical "last value" bar chart. */}
      {laidOut
        .filter((series) => series.style.drawStyle === 'bar')
        .flatMap((series) =>
          series.renderPoints.flatMap((point) => {
            if (point.base == null || point.top == null) return []
            const y1 = yScale(point.base)
            const y2 = yScale(point.top)

            return [
              <rect
                key={`bar-${series.id}-${String(point.time)}`}
                x={xScale(point.time) - barWidth / 2}
                y={Math.min(y1, y2)}
                width={barWidth}
                height={Math.max(1, Math.abs(y2 - y1))}
                fill={series.color}
                rx={1}
              />,
            ]
          }),
        )}

      {laidOut
        .filter((series) => series.style.drawStyle === 'line' || series.style.drawStyle === 'area')
        .map((series) => (
          <path
            key={`line-${series.id}`}
            d={buildLinePath(series.renderPoints, xScale, yScale)}
            fill="none"
            stroke={series.color}
            strokeWidth={series.style.lineWidth ?? 1.4}
            strokeLinejoin="round"
          />
        ))}
    </svg>
  )
}
