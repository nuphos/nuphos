import { useEffect, useMemo, useRef, useState } from 'react'

import { formatValue } from '../format'
import { buildPieSlices, pieLabelAnchor, pieOptions, pieSlicePath } from '../pieChart'

import type { PieOptions, PieRing, PieSlice } from '../pieChart'
import type { DataFrame, Panel } from '../types'

type Props = {
  frames: DataFrame[]
  panel: Panel
  unit?: string
}

// A slice needs some arc to hold a label at all; below this it would just
// overprint its neighbours.
const LABEL_MIN_FRACTION = 0.06

export function PieChartPanel({ frames, panel, unit }: Props) {
  const slices = useMemo(() => buildPieSlices(frames, panel), [frames, panel])
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

  if (slices.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px]">
        No data
      </div>
    )
  }
  const options = pieOptions(panel)

  return (
    <div
      className={`absolute inset-0 flex gap-2 p-1.5 ${
        options.legend === 'bottom' ? 'flex-col' : 'flex-row'
      }`}
    >
      <div ref={ref} className="relative min-h-0 min-w-0 flex-1">
        {size.w > 0 && size.h > 0 && (
          <Pie slices={slices} options={options} unit={unit} width={size.w} height={size.h} />
        )}
      </div>
      {options.legend !== 'hidden' && <Legend slices={slices} unit={unit} options={options} />}
    </div>
  )
}

function Legend({
  slices,
  unit,
  options,
}: {
  slices: PieSlice[]
  unit?: string
  options: PieOptions
}) {
  return (
    <div
      className={`min-h-0 overflow-auto scrollbar-thin text-[11px] ${
        options.legend === 'bottom'
          ? 'flex max-h-[45%] flex-row flex-wrap gap-x-3 gap-y-0.5'
          : 'flex w-[42%] max-w-[220px] flex-col gap-0.5'
      }`}
    >
      {slices.map((slice) => (
        <div key={slice.label} className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-sm"
            style={{ background: slice.color }}
            aria-hidden
          />
          <span className="truncate text-secondary" title={slice.label}>
            {slice.label}
          </span>
          <span className="ml-auto flex-shrink-0 text-tertiary">
            {formatValue(slice.value, unit)}
          </span>
        </div>
      ))}
    </div>
  )
}

function Pie({
  slices,
  options,
  unit,
  width,
  height,
}: {
  slices: PieSlice[]
  options: PieOptions
  unit?: string
  width: number
  height: number
}) {
  const outer = Math.max(8, Math.min(width, height) / 2 - 4)
  const ring: PieRing = {
    cx: width / 2,
    cy: height / 2,
    outer,
    inner: options.donut ? outer * 0.6 : 0,
  }

  return (
    <svg width={width} height={height} className="absolute inset-0">
      {slices.map((slice) => {
        const label = sliceLabel(slice, options, unit)
        const [lx, ly] = pieLabelAnchor(ring, slice)

        return (
          <g key={slice.label}>
            <title>{`${slice.label}: ${formatValue(slice.value, unit)}`}</title>
            <path
              d={pieSlicePath(ring, slice.fromDeg, slice.toDeg)}
              fill={slice.color}
              stroke="rgb(var(--color-zGray-900))"
              strokeWidth={1}
            />
            {label && slice.fraction >= LABEL_MIN_FRACTION && (
              <text
                x={lx}
                y={ly + 3}
                textAnchor="middle"
                fontSize={10}
                fill="#fff"
                style={{ pointerEvents: 'none' }}
              >
                {label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function sliceLabel(slice: PieSlice, options: PieOptions, unit?: string): string {
  const parts: string[] = []

  if (options.labels.name) parts.push(slice.label)
  if (options.labels.value) parts.push(formatValue(slice.value, unit))
  if (options.labels.percent) parts.push(`${(slice.fraction * 100).toFixed(1)}%`)

  return parts.join(' ')
}
