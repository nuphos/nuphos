import { useEffect, useMemo, useRef, useState } from 'react'

import { formatTime, formatValue } from '../format'
import { buildHeatmap } from '../heatmap'

import type { HeatmapModel } from '../heatmap'
import type { DataFrame } from '../types'

type Props = {
  frames: DataFrame[]
  options?: Record<string, unknown>
}

// Grafana "heatmap" panel for Prometheus histogram buckets (`format:
// "heatmap"` targets). The bucket de-accumulation lives in ../heatmap.ts.
export function HeatmapPanel({ frames, options }: Props) {
  const model = useMemo(() => buildHeatmap(frames), [frames])
  const unit =
    typeof (options?.yAxis as { unit?: string } | undefined)?.unit === 'string'
      ? (options?.yAxis as { unit?: string }).unit
      : undefined

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current

    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })

    update()
    const ro = new ResizeObserver(update)

    ro.observe(el)

    return () => ro.disconnect()
  }, [])

  if (!model || model.times.length === 0 || model.buckets.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No data
      </div>
    )
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {size.w > 0 && size.h > 0 && (
        <HeatmapChart model={model} unit={unit} width={size.w} height={size.h} />
      )}
    </div>
  )
}

function HeatmapChart({
  model,
  unit,
  width,
  height,
}: {
  model: HeatmapModel
  unit?: string
  width: number
  height: number
}) {
  const { times, buckets, cells, max } = model

  // Left padding follows the widest bucket label so values don't get clipped.
  const bucketLabel = (le: number) => (le === Infinity ? '+Inf' : formatValue(le, unit))
  const maxLabelLen = Math.max(...buckets.map((le) => bucketLabel(le).length), 1)
  const padding = {
    top: 6,
    right: 8,
    bottom: 20,
    left: Math.min(96, Math.max(36, 10 + maxLabelLen * 6)),
  }
  const plotW = Math.max(0, width - padding.left - padding.right)
  const plotH = Math.max(0, height - padding.top - padding.bottom)

  const cellW = plotW / times.length
  const cellH = plotH / buckets.length

  // Row 0 is the smallest bucket → drawn at the bottom.
  const yFor = (bucketIdx: number) => padding.top + plotH - (bucketIdx + 1) * cellH

  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(plotH / 28))))
  const timeLabelEvery = Math.max(1, Math.ceil(times.length / Math.max(2, Math.floor(plotW / 90))))
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0

  return (
    <svg width={width} height={height} className="absolute inset-0">
      {cells.map((row, b) =>
        row.map((v, t) => {
          if (v <= 0 || max <= 0) return null
          const alpha = 0.12 + 0.88 * Math.sqrt(v / max)

          return (
            <rect
              key={`${String(b)}-${String(t)}`}
              x={padding.left + t * cellW}
              y={yFor(b)}
              width={Math.max(0, cellW - 0.5)}
              height={Math.max(0, cellH - 0.5)}
              fill={`rgba(var(--color-zViolet-accent), ${alpha.toFixed(3)})`}
            />
          )
        }),
      )}
      {buckets.map((le, b) =>
        b % labelEvery === 0 ? (
          <text
            key={`y-${String(b)}`}
            x={padding.left - 6}
            y={yFor(b) + cellH}
            textAnchor="end"
            fontSize={10}
            fill="rgb(var(--color-text-tertiary))"
          >
            {bucketLabel(le)}
          </text>
        ) : null,
      )}
      {times.map((t, i) =>
        i % timeLabelEvery === 0 ? (
          <text
            key={`x-${String(t)}`}
            x={padding.left + i * cellW + cellW / 2}
            y={height - padding.bottom + 14}
            textAnchor="middle"
            fontSize={10}
            fill="rgb(var(--color-text-tertiary))"
          >
            {formatTime(t, span)}
          </text>
        ) : null,
      )}
    </svg>
  )
}
