import { useEffect, useState } from 'react'
import { Area, AreaChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { api } from '../../api'
import { t } from '../../i18n'

import { chartTicks, tickLabel } from './billingPresentation'
import { ACCENT, CAPACITY, RangeSwitch } from './MetricChart'
import { QUOTA_HISTORY_RANGES } from './quotaHistoryRows'
import { PanelHeading } from './RuntimePanel'

import type { RuntimeQuotaHistoryRange } from '../../types/runtime'

type Point = { at: number; used: number; limit: number | null }

const RANGE_OPTIONS = (Object.keys(QUOTA_HISTORY_RANGES) as RuntimeQuotaHistoryRange[]).map(
  (value) => ({ value, label: QUOTA_HISTORY_RANGES[value].label }),
)
const TICK = { fill: 'rgb(var(--color-text-tertiary))', fontSize: 10 }

const timeLabel = (at: number, range: RuntimeQuotaHistoryRange) =>
  new Date(at).toLocaleString(
    undefined,
    range === '1d'
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  )

/**
 * The team's running Box vCPUs over time, with its plan limit as a dashed step line.
 * `pastOnly` shows nothing until some Box has run in the last 30 days.
 */
export function BoxUsageChart({
  teamId,
  showLimit,
  pastOnly = false,
}: {
  teamId: string
  showLimit: boolean
  pastOnly?: boolean
}) {
  const [range, setRange] = useState<RuntimeQuotaHistoryRange>(pastOnly ? '30d' : '7d')
  const [used, setUsed] = useState(false)
  const [points, setPoints] = useState<Point[] | null>(null)

  useEffect(() => {
    let cancelled = false

    api.boxUsageHistory(teamId, range).then(
      ({ points: next }) => {
        if (cancelled) return
        setPoints(
          next.map((p) => ({ at: Date.parse(p.at), used: p.usedVcpus, limit: p.limitVcpus })),
        )
        if (next.some((p) => p.usedVcpus > 0)) setUsed(true)
      },
      () => {
        /* History is decoration; keep whatever was shown before. */
      },
    )

    return () => {
      cancelled = true
    }
  }, [teamId, range])

  const empty = points?.every((p) => p.used === 0) ?? false

  if (pastOnly && !used) return null
  const span = points && points.length > 0 ? [points[0].at, points[points.length - 1].at] : null

  return (
    <section>
      <PanelHeading
        title={t('vCPU over time')}
        hint={t('Highest running vCPU per {bucket}', {
          bucket: QUOTA_HISTORY_RANGES[range].bucketLabel,
        })}
        right={
          <div className="flex items-center gap-3 text-[11px] text-tertiary">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: ACCENT }}
              />
              {t('Running vCPU')}
            </span>
            {showLimit && (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="w-3 border-t border-dashed"
                  style={{ borderColor: CAPACITY }}
                />
                {t('Plan limit')}
              </span>
            )}
            <RangeSwitch
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
              label={t('Time range')}
            />
          </div>
        }
      />
      {empty ? (
        <p className="rounded-xl border border-dashed border-zGray-800 px-4 py-6 text-center text-xs leading-5 text-tertiary">
          {t('No computers ran in this range.')}
        </p>
      ) : (
        <div className="h-40 rounded-xl border border-zGray-800/60 bg-surface/40 px-2 pb-1 pt-3">
          {points && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="at"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tick={TICK}
                  tickLine={false}
                  axisLine={false}
                  ticks={span ? chartTicks(span[0], span[1], range) : undefined}
                  tickFormatter={(at: number) => tickLabel(at, range)}
                />
                <YAxis
                  width={24}
                  allowDecimals={false}
                  domain={[0, (max: number) => Math.max(max, 1)]}
                  tick={TICK}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ stroke: 'rgba(164, 105, 255, 0.4)' }}
                  content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as Point | undefined

                    if (!active || !point) return null
                    const atLimit = point.limit !== null && point.used >= point.limit

                    return (
                      <div className="rounded-md border border-zGray-800 bg-zGray-950/95 px-2 py-1 text-[11px] shadow-lg">
                        <div className="text-tertiary">{timeLabel(point.at, range)}</div>
                        <div className={atLimit ? 'font-mono text-warning' : 'font-mono text-main'}>
                          {point.used}
                          {showLimit && point.limit !== null && (
                            <span className="text-tertiary"> / {point.limit}</span>
                          )}{' '}
                          <span className="text-tertiary">{t('vCPU running')}</span>
                        </div>
                      </div>
                    )
                  }}
                />
                <Area
                  type="stepAfter"
                  dataKey="used"
                  stroke={ACCENT}
                  strokeWidth={1.5}
                  fill={ACCENT}
                  fillOpacity={0.15}
                  isAnimationActive={false}
                />
                {showLimit && (
                  <Line
                    type="stepAfter"
                    dataKey="limit"
                    stroke={CAPACITY}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  )
}
