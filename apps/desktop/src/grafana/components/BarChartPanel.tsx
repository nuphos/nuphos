import { useEffect, useMemo, useRef, useState } from 'react'

import { colorFor, formatValue } from '../format'

import type { DataFrame } from '../types'

type Bar = { label: string; value: number }

type Props = {
  frames: DataFrame[]
  unit?: string
}

export function BarChartPanel({ frames, unit }: Props) {
  const bars = useMemo(() => buildBars(frames), [frames])
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current

    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })

    update()
    const ro = new ResizeObserver(update)

    ro.observe(el)

    return () => ro.disconnect()
  }, [])

  if (bars.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No data
      </div>
    )
  }

  return (
    <div ref={ref} className="absolute inset-0">
      {size.w > 0 && size.h > 0 && <Bars bars={bars} unit={unit} width={size.w} height={size.h} />}
    </div>
  )
}

function Bars({
  bars,
  unit,
  width,
  height,
}: {
  bars: Bar[]
  unit?: string
  width: number
  height: number
}) {
  const max = Math.max(0, ...bars.map((b) => b.value))
  const niceMax = max <= 0 ? 1 : niceCeiling(max)

  // Left padding follows the widest y label so long values don't get clipped.
  const probeTicks = niceTicks(0, niceMax, Math.max(2, Math.floor((height - 36) / 36)))
  const maxLabelLen = Math.max(...probeTicks.map((v) => formatValue(v, unit).length), 1)
  const padding = {
    top: 8,
    right: 12,
    bottom: 28,
    left: Math.min(96, Math.max(36, 10 + maxLabelLen * 6)),
  }
  const plotW = Math.max(0, width - padding.left - padding.right)
  const plotH = Math.max(0, height - padding.top - padding.bottom)

  const yScale = (v: number) => padding.top + plotH - (v / niceMax) * plotH

  const slot = plotW / bars.length
  const barW = Math.max(2, slot * 0.7)

  const yTicks = niceTicks(0, niceMax, Math.max(2, Math.floor(plotH / 36)))

  return (
    <svg width={width} height={height} className="absolute inset-0">
      {yTicks.map((v) => {
        const y = yScale(v)

        return (
          <g key={v}>
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
      {bars.map((b, i) => {
        const cx = padding.left + i * slot + slot / 2
        const x = cx - barW / 2
        const y = yScale(b.value)

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={padding.top + plotH - y}
              fill={colorFor(i)}
              rx={2}
            />
            <text
              x={cx}
              y={height - padding.bottom + 14}
              textAnchor="middle"
              fontSize={10}
              fill="rgb(var(--color-text-tertiary))"
            >
              {truncate(b.label, Math.max(4, Math.floor(slot / 6)))}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function buildBars(frames: DataFrame[]): Bar[] {
  const bars: Bar[] = []

  for (const f of frames) {
    const numField = f.fields.find((x) => x.type === 'number')

    if (!numField) continue
    // Take last value of each frame as the bar value.
    let v: number | null = null

    for (let i = numField.values.length - 1; i >= 0; i--) {
      const n = Number(numField.values[i])

      if (Number.isFinite(n)) {
        v = n
        break
      }
    }
    if (v == null) continue
    const labels = numField.labels
    const label = labels
      ? Object.entries(labels)
          .filter(([k]) => !k.startsWith('__'))
          .map(([_, val]) => val)
          .join(', ') ||
        (f.name ?? '?')
      : (f.name ?? '?')

    bars.push({ label, value: v })
  }

  return bars.sort((a, b) => b.value - a.value)
}

function niceCeiling(v: number): number {
  const mag = 10 ** Math.floor(Math.log10(v))
  const norm = v / mag
  let m: number

  if (norm <= 1) m = 1
  else if (norm <= 2) m = 2
  else if (norm <= 5) m = 5
  else m = 10

  return m * mag
}

function niceTicks(min: number, max: number, count: number): number[] {
  const step = (max - min) / count
  const out: number[] = []

  for (let v = min; v <= max + step / 2; v += step) out.push(v)

  return out
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s

  return `${s.slice(0, Math.max(1, n - 1))}…`
}
