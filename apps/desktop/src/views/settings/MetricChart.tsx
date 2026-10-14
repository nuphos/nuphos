import clsx from 'clsx'
import {
  Area,
  AreaChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const ACCENT = 'rgb(164, 105, 255)'
const CAPACITY = 'rgb(118, 124, 140)'

/** The faint band behind a stretch with no reading; legends reuse it. */
export const GAP_FILL = 'rgba(118, 124, 140, 0.08)'

export type MetricPoint = { at: number; value: number | null; capacity?: number | null }

/** A stretch of time with no reading, drawn as a faint band. */
export type MetricGap = { from: number; to: number }

/** One small titled area chart: the newest value in the corner, a second dimmed line
 *  for the capacity the metric is measured against, and faint bands where nothing was
 *  read. A reading with no neighbour gets a dot, since a lone point draws no area. */
export function MetricChart({
  title,
  data,
  format,
  timeLabel,
  domain,
  max,
  gaps = [],
}: {
  title: string
  data: MetricPoint[]
  format: (value: number) => string
  timeLabel: (at: number) => string
  /** The time span to draw; defaults to the first and last point. */
  domain?: [number, number]
  /** A fixed ceiling, e.g. 100 for a percentage; otherwise the axis fits the data. */
  max?: number
  gaps?: MetricGap[]
}) {
  const newest = [...data].reverse()
  const latest = newest.find((p) => p.value !== null)?.value ?? null
  const latestCapacity = newest.find((p) => p.capacity != null)?.capacity ?? null
  const hasCapacity = data.some((p) => p.capacity != null)

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-tertiary">{title}</span>
        <span className="font-mono text-main">
          {latest === null ? '—' : format(latest)}
          {latestCapacity === null ? null : (
            <span className="text-tertiary"> / {format(latestCapacity)}</span>
          )}
        </span>
      </div>
      <div className="mt-1 h-16 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="at"
              type="number"
              scale="time"
              domain={domain ?? ['dataMin', 'dataMax']}
              hide
            />
            <YAxis hide domain={[0, max ?? 'auto']} allowDecimals={false} />
            {gaps.map((gap) => (
              <ReferenceArea
                key={gap.from}
                x1={gap.from}
                x2={gap.to}
                fill={GAP_FILL}
                fillOpacity={1}
                stroke="none"
                ifOverflow="hidden"
              />
            ))}
            <Tooltip
              cursor={{ stroke: 'rgba(164, 105, 255, 0.4)' }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as MetricPoint | undefined

                if (!active || !point) return null

                return (
                  <div className="rounded-md border border-zGray-800 bg-zGray-950/95 px-2 py-1 text-[11px] shadow-lg">
                    <div className="text-tertiary">{timeLabel(point.at)}</div>
                    <div className="font-mono text-main">
                      {point.value === null ? 'No reading' : format(point.value)}
                      {point.capacity == null ? null : (
                        <span className="text-tertiary"> / {format(point.capacity)}</span>
                      )}
                    </div>
                  </div>
                )
              }}
            />
            {hasCapacity ? (
              <Area
                type="monotone"
                dataKey="capacity"
                stroke={CAPACITY}
                strokeWidth={1}
                strokeDasharray="3 3"
                fill="none"
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="value"
              stroke={ACCENT}
              strokeWidth={1.5}
              fill={ACCENT}
              fillOpacity={0.15}
              connectNulls={false}
              isAnimationActive={false}
              dot={({ index, cx, cy }: { index: number; cx?: number; cy?: number }) =>
                cx !== undefined &&
                cy !== undefined &&
                data[index]?.value != null &&
                data[index - 1]?.value == null &&
                data[index + 1]?.value == null ? (
                  <circle key={index} cx={cx} cy={cy} r={1.75} fill={ACCENT} />
                ) : (
                  <g key={index} />
                )
              }
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** The small segmented switch above a set of charts. */
export function RangeSwitch<Value extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: Value; label: string }[]
  value: Value
  onChange: (value: Value) => void
  label: string
}) {
  return (
    <div
      className="flex gap-0.5 rounded-md border border-zGray-800/70 p-0.5"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded px-1.5 py-0.5 text-[11px]',
            value === option.value
              ? 'bg-zGray-800/80 text-main'
              : 'text-tertiary hover:bg-zGray-800/40 hover:text-main',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
