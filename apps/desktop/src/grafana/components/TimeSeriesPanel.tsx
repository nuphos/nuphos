import { useEffect, useMemo, useRef, useState } from 'react'

import { colorFor, renderLegend } from '../format'
import { DEFAULT_TIME_SERIES_STYLE } from '../timeSeriesDisplay'

import { Chart } from './timeSeriesPanel/Chart'
import { Legend, Tooltip } from './timeSeriesPanel/overlays'

import type { TimeSeriesStyle } from '../timeSeriesDisplay'
import type { DataFrame, PanelTarget } from '../types'
import type { Series } from './timeSeriesPanel/types'

type Props = {
  frames: DataFrame[]
  unit?: string
  targets: PanelTarget[]
  styles?: Record<string, TimeSeriesStyle>
  min?: number
  max?: number
  centeredZero?: boolean
  showLegend?: boolean
}

export function TimeSeriesPanel({
  frames,
  unit,
  targets,
  styles,
  min,
  max,
  centeredZero,
  showLegend = true,
}: Props) {
  const series = useMemo(() => buildSeries(frames, targets, styles), [frames, targets, styles])
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

  const [hover, setHover] = useState<{ x: number; y: number; ts: number } | null>(null)

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {size.w > 0 && size.h > 0 && (
          <Chart
            series={series}
            unit={unit}
            width={size.w}
            height={size.h}
            min={min}
            max={max}
            centeredZero={centeredZero}
            onHover={setHover}
          />
        )}
        {hover && (
          <Tooltip
            x={hover.x}
            y={hover.y}
            ts={hover.ts}
            series={series}
            unit={unit}
            width={size.w}
            height={size.h}
          />
        )}
      </div>
      {showLegend && <Legend series={series} />}
    </div>
  )
}

function buildSeries(
  frames: DataFrame[],
  targets: PanelTarget[],
  styles?: Record<string, TimeSeriesStyle>,
): Series[] {
  const out: Series[] = []
  let i = 0

  for (const f of frames) {
    const timeField = f.fields.find((x) => x.type === 'time')
    const valField = f.fields.find((x) => x.type === 'number')

    if (!timeField || !valField) continue
    const target = targets.find((t) => t.refId === f.refId) ?? targets[0]
    const label = renderLegend(
      valField.labels,
      target?.legendFormat,
      f.name || `series ${String(i + 1)}`,
    )
    const points: [number, number | null][] = []
    const len = Math.min(timeField.values.length, valField.values.length)

    for (let j = 0; j < len; j++) {
      const t = Number(timeField.values[j])
      const raw = valField.values[j]
      const v = raw == null ? null : Number(raw)

      points.push([t, v == null || !Number.isFinite(v) ? null : v])
    }
    out.push({
      id: `${f.refId}:${String(i)}`,
      label,
      color: colorFor(i),
      points,
      style: styles?.[f.refId] ?? DEFAULT_TIME_SERIES_STYLE,
    })
    i++
  }

  return out
}
