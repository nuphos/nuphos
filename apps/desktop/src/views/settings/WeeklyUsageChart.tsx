import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'

import { t } from '../../i18n'

import { chartTicks, tickLabel } from './billingPresentation'
import { ACCENT, GAP_FILL } from './MetricChart'
import { WEEK_MS, dayTime, readingGaps, weeklyPace } from './weeklyPace'
import { WeeklyUsageHeader } from './WeeklyUsageHeader'

import type { MetricPoint } from './MetricChart'
import type { RuntimeInstance, RuntimeQuota, RuntimeQuotaWindow } from '../../types/runtime'

const LIMIT = 'rgb(var(--color-error))'
const MUTED = 'rgb(var(--color-text-tertiary))'
const TICK = { fill: MUTED, fontSize: 10 }
const HOUR = 3_600_000

/** Text beside a vertical line, at its top or bottom, so it never sits on the line. */
function besideLine(lines: string[], side: 'right' | 'left', at: 'top' | 'bottom', fill = MUTED) {
  return function LineLabel({
    viewBox,
  }: {
    viewBox?: { x?: number; y?: number; height?: number }
  }) {
    const x = (viewBox?.x ?? 0) + (side === 'right' ? 4 : -4)
    const y =
      at === 'top' ? (viewBox?.y ?? 0) + 11 : (viewBox?.y ?? 0) + (viewBox?.height ?? 0) - 16

    return (
      <text x={x} y={y} fontSize={10} fill={fill} textAnchor={side === 'right' ? 'start' : 'end'}>
        {lines.map((line, i) => (
          <tspan key={line} x={x} dy={i === 0 ? 0 : 12} fontWeight={i === 0 ? 500 : 400}>
            {line}
          </tspan>
        ))}
      </text>
    )
  }
}

/** One runtime's weekly window: what was used since a week ago, where it stands now and,
 *  at the pace since its last reset, where it ends up by the next one. */
export function WeeklyUsageChart({
  instance,
  quota,
  window,
  points,
  fallbackName,
  nowMs,
}: {
  instance: RuntimeInstance
  quota: RuntimeQuota | undefined
  window: RuntimeQuotaWindow
  /** The window's hourly readings over the last 7 days. */
  points: MetricPoint[]
  /** The runtime its Bots and Tasks switch to, when one is set. */
  fallbackName: string | null
  nowMs: number
}) {
  const resetsAt = Date.parse(window.resetsAt ?? '')
  const lastReset = resetsAt - WEEK_MS
  const used = Math.round(window.usedPercent)
  const pace = weeklyPace(window, points, nowMs)
  const from = nowMs - WEEK_MS
  const to = Math.max(resetsAt, nowMs)
  const rows: {
    at: number
    used?: number | null
    limit?: number | null
    ahead?: number
    out?: number
  }[] = [
    ...points.map(({ at, value }) => ({
      at,
      used: value,
      limit: value !== null && value >= 100 ? 100 : null,
    })),
    { at: nowMs, used, limit: used >= 100 ? 100 : null, ahead: used },
  ]

  if (pace.kind === 'runsOut')
    rows.push({ at: pace.at, ahead: 100, out: 100 }, { at: resetsAt, out: 100 })
  if (pace.kind === 'onPace') rows.push({ at: resetsAt, ahead: pace.atReset })
  // Day ticks every other day, and none crowding "Now".
  const ticks = [
    ...chartTicks(from, to, '7d').filter(
      (at, i) => i % 2 === 0 && Math.abs(at - nowMs) > 12 * HOUR,
    ),
    nowMs,
  ].sort((a, b) => a - b)

  return (
    <div className="@container px-4 pt-4">
      <WeeklyUsageHeader
        instance={instance}
        quota={quota}
        window={window}
        pace={pace}
        fallbackName={fallbackName}
        nowMs={nowMs}
      />
      <div className="mt-3 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {/* The top margin holds the limit label above the 100% line, clear of the projection. */}
          <ComposedChart
            data={rows.toSorted((a, b) => a.at - b.at)}
            margin={{ top: 18, right: 4, left: -18, bottom: 0 }}
          >
            <XAxis
              dataKey="at"
              type="number"
              scale="time"
              domain={[from, to]}
              ticks={ticks}
              tickFormatter={(at: number) => (at === nowMs ? t('Now') : tickLabel(at, '7d'))}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              allowDataOverflow
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tickFormatter={(value: number) => `${String(value)}%`}
              tick={TICK}
              tickLine={false}
              axisLine={false}
            />
            {readingGaps(points, nowMs).map((gap) => (
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
            <ReferenceArea x1={nowMs} x2={to} fill={GAP_FILL} fillOpacity={1} stroke="none" />
            <ReferenceLine y={100} stroke={MUTED} strokeOpacity={0.3} />
            {lastReset > from && (
              <ReferenceLine
                x={lastReset}
                stroke={MUTED}
                strokeDasharray="2 3"
                label={besideLine([t('Reset'), dayTime(lastReset)], 'right', 'top')}
              />
            )}
            <ReferenceLine
              x={resetsAt}
              stroke={MUTED}
              strokeDasharray="2 3"
              label={besideLine([t('Next reset'), dayTime(resetsAt)], 'left', 'bottom')}
            />
            <ReferenceLine x={nowMs} stroke={MUTED} strokeOpacity={0.6} />
            <Area
              type="stepAfter"
              dataKey="used"
              stroke={ACCENT}
              strokeWidth={1.5}
              fill={ACCENT}
              fillOpacity={0.1}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="limit"
              stroke={LIMIT}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="ahead"
              stroke={ACCENT}
              strokeWidth={1.25}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="out"
              stroke={LIMIT}
              strokeWidth={2}
              strokeDasharray="2 2"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <ReferenceDot
              x={nowMs}
              y={used}
              r={3}
              fill="rgb(var(--color-background-surface))"
              stroke={pace.kind === 'usedUp' ? LIMIT : ACCENT}
              strokeWidth={1.5}
              // Used up, the heading says so and the label would sit on the limit line.
              label={
                pace.kind === 'usedUp'
                  ? undefined
                  : {
                      value: `${String(used)}%`,
                      position: 'left',
                      fill: 'rgb(var(--color-text-primary))',
                      fontSize: 10,
                      offset: 8,
                    }
              }
            />
            {pace.kind === 'runsOut' && (
              <ReferenceDot
                x={pace.at}
                y={100}
                r={0}
                label={{
                  value: t('Limit ~{when}', {
                    when: new Date(pace.at).toLocaleString(undefined, {
                      weekday: 'short',
                      hour: 'numeric',
                    }),
                  }),
                  position: 'top',
                  fill: LIMIT,
                  fontSize: 10,
                  offset: 6,
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
