import clsx from 'clsx'
import { useId, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { ChartPayload } from './agent/chartPayload'

// Pulled from index.css palette so charts feel like the rest of Nuphos.
// Order matters: index 0 is the dominant series accent.
const SERIES_COLORS = [
  'rgb(164, 105, 255)', // zViolet-accent
  'rgb(116, 93, 243)', // zViolet-400
  'rgb(238, 67, 14)', // zOrangered-500
  'rgb(52, 211, 153)', // emerald-400
  'rgb(96, 165, 250)', // blue-400
  'rgb(251, 191, 36)', // amber-400
]

const AXIS_STYLE = {
  fontSize: 11,
  fill: 'rgb(var(--color-text-tertiary))',
} as const

const GRID_STROKE = 'rgba(var(--color-zGray-800), 0.6)'

function TooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: {
    color?: string
    name?: string | number
    value?: string | number | null
    dataKey?: string
  }[]
  label?: string | number
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-md border border-zGray-800 bg-zGray-950/95 px-2.5 py-1.5 text-[12px] shadow-lg">
      {label !== undefined && <div className="mb-1 font-medium text-main">{String(label)}</div>}
      <div className="space-y-0.5">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-tertiary">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-secondary">{String(p.name ?? p.dataKey ?? '')}</span>
            <span className="ml-auto font-mono text-main">
              {p.value == null ? '—' : String(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Shared chart body. Layout chrome and payload headings belong to its host. */
export function ChartPlot({ payload, className }: { payload: ChartPayload; className?: string }) {
  const { type, xKey, series, data, stacked } = payload
  const gradientId = useId()
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(new Set())

  const colored = useMemo(
    () => series.map((s, i) => ({ ...s, color: SERIES_COLORS[i % SERIES_COLORS.length] })),
    [series],
  )
  const visible = colored.filter((s) => !hiddenKeys.has(s.key))

  const showLegend = colored.length > 1
  const stackId = stacked ? 'stack' : undefined
  // Overlapping opaque fills merge multiple series into one unreadable band. Fill
  // heavily only for a single series (or stacked, where fills genuinely tile);
  // otherwise keep the fill faint so each series reads as its own line.
  const fillTop = stacked ? 0.7 : showLegend ? 0.12 : 0.5
  const fillBottom = stacked ? 0.25 : showLegend ? 0.02 : 0.05

  const toggleSeries = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev)

      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })
  }

  return (
    <div className={clsx('flex w-full flex-col', className)}>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'area' ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                {visible.map((s, i) => (
                  <linearGradient
                    key={s.key}
                    id={`${gradientId}-${String(i)}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={s.color} stopOpacity={fillTop} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={fillBottom} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} />
              <Tooltip content={<TooltipContent />} cursor={{ stroke: GRID_STROKE }} />
              {visible.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label ?? s.key}
                  stackId={stackId}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#${gradientId}-${String(i)})`}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          ) : type === 'bar' ? (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} />
              <Tooltip
                content={<TooltipContent />}
                cursor={{ fill: 'rgba(164, 105, 255, 0.08)' }}
              />
              {visible.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label ?? s.key}
                  stackId={stackId}
                  fill={s.color}
                  radius={stacked ? 0 : [3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} />
              <Tooltip content={<TooltipContent />} cursor={{ stroke: GRID_STROKE }} />
              {visible.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label ?? s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      {showLegend && (
        <div className="mt-1.5 flex max-h-12 w-full flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
          {colored.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => toggleSeries(s.key)}
              className={clsx(
                'flex items-center gap-1.5 text-[12px] text-secondary transition-opacity hover:text-main',
                hiddenKeys.has(s.key) && 'opacity-40',
              )}
            >
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label ?? s.key}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
