import { useEffect, useRef, useState } from 'react'

import { formatValue } from '../format'
import { thresholdColor } from '../table'

import type { DataFrame, Panel } from '../types'

type Props = {
  frames: DataFrame[]
  panel: Panel
}

// Grafana "gauge" panel: a 270° arc filled proportionally to the value,
// colored by the field thresholds, with a thin outer threshold band.
export function GaugePanel({ frames, panel }: Props) {
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

  const value = lastNumeric(frames)
  const defaults = panel.fieldConfig?.defaults
  const min = defaults?.min ?? 0
  const max = defaults?.max ?? 100
  const unit = defaults?.unit
  const steps = (defaults?.thresholds?.steps ?? []).map((s) => ({
    color: s.color ?? 'green',
    value: typeof s.value === 'number' ? s.value : null,
  }))

  if (value == null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No data
      </div>
    )
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {size.w > 0 && size.h > 0 && (
        <Gauge
          value={value}
          min={min}
          max={max}
          unit={unit}
          steps={steps}
          width={size.w}
          height={size.h}
        />
      )}
    </div>
  )
}

const START_DEG = 135
const SWEEP_DEG = 270

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180

  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const [x0, y0] = polar(cx, cy, r, fromDeg)
  const [x1, y1] = polar(cx, cy, r, toDeg)
  const large = toDeg - fromDeg > 180 ? 1 : 0

  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${String(r)},${String(r)} 0 ${String(large)} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
}

function Gauge({
  value,
  min,
  max,
  unit,
  steps,
  width,
  height,
}: {
  value: number
  min: number
  max: number
  unit?: string
  steps: { color: string; value: number | null }[]
  width: number
  height: number
}) {
  const cx = width / 2
  const cy = height / 2 + height * 0.04
  const r = Math.max(10, Math.min(width, height) / 2 - 14)
  const stroke = Math.max(6, r * 0.18)

  const clamped = Math.min(max, Math.max(min, value))
  const frac = max > min ? (clamped - min) / (max - min) : 0
  const valueDeg = START_DEG + SWEEP_DEG * frac
  const color = thresholdColor(value, steps) ?? '#73bf69'

  const degFor = (v: number) =>
    START_DEG + SWEEP_DEG * (max > min ? (Math.min(max, Math.max(min, v)) - min) / (max - min) : 0)

  // Outer threshold band: one segment per step, from its start value to the
  // next step's start (Grafana's showThresholdMarkers ring).
  const band = steps.map((s, i) => {
    const from = s.value == null ? min : s.value
    const to = i + 1 < steps.length ? (steps[i + 1].value ?? max) : max

    return {
      color: thresholdColor(from, steps) ?? '#73bf69',
      fromDeg: degFor(from),
      toDeg: degFor(to),
    }
  })

  return (
    <svg width={width} height={height} className="absolute inset-0">
      {band.map((b, i) =>
        b.toDeg > b.fromDeg ? (
          <path
            key={i}
            d={arcPath(cx, cy, r + stroke / 2 + 3, b.fromDeg, b.toDeg)}
            fill="none"
            stroke={b.color}
            strokeWidth={2}
          />
        ) : null,
      )}
      <path
        d={arcPath(cx, cy, r, START_DEG, START_DEG + SWEEP_DEG)}
        fill="none"
        stroke="rgba(var(--color-zGray-800), 0.8)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {valueDeg > START_DEG && (
        <path
          d={arcPath(cx, cy, r, START_DEG, valueDeg)}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      )}
      <text
        x={cx}
        y={cy + 5}
        textAnchor="middle"
        fontWeight={600}
        fontSize={Math.max(13, Math.min(26, r * 0.42))}
        fill={color}
      >
        {formatValue(value, unit)}
      </text>
      <text
        x={polar(cx, cy, r, START_DEG)[0]}
        y={polar(cx, cy, r, START_DEG)[1] + stroke + 4}
        textAnchor="middle"
        fontSize={9.5}
        fill="rgb(var(--color-text-tertiary))"
      >
        {formatValue(min, unit)}
      </text>
      <text
        x={polar(cx, cy, r, START_DEG + SWEEP_DEG)[0]}
        y={polar(cx, cy, r, START_DEG + SWEEP_DEG)[1] + stroke + 4}
        textAnchor="middle"
        fontSize={9.5}
        fill="rgb(var(--color-text-tertiary))"
      >
        {formatValue(max, unit)}
      </text>
    </svg>
  )
}

function lastNumeric(frames: DataFrame[]): number | null {
  for (const f of frames) {
    const numField = f.fields.find((x) => x.type === 'number')

    if (!numField) continue
    for (let i = numField.values.length - 1; i >= 0; i--) {
      const v = numField.values[i]

      if (v == null) continue
      const n = Number(v)

      if (Number.isFinite(n)) return n
    }
  }

  return null
}
