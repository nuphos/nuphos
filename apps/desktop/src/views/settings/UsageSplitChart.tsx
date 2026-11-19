import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { SERIES_COLORS } from '../../components/chartColors'
import { t } from '../../i18n'

import { formatTokens } from './tokenUsagePresentation'

const color = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length]
const dayLabel = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** One bar a day, stacked by the largest groups of the table's grouping, so a spike shows who or
 *  what drove it. */
export function UsageSplitChart({
  series,
  points,
  total,
}: {
  series: { key: string; label: string }[]
  points: Record<string, number>[]
  total: number
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px]">
        <span className="text-tertiary">{t('Tokens per day')}</span>
        <span className="whitespace-nowrap font-mono text-main">
          {t('{tokens} tokens', { tokens: formatTokens(total) })}
        </span>
      </div>
      <div className="mt-1 h-24 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={points}
            margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
            barCategoryGap="20%"
          >
            <XAxis dataKey="at" hide />
            <YAxis hide domain={[0, 'auto']} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'rgba(var(--color-data-1), 0.08)' }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as Record<string, number> | undefined

                if (!active || !point) return null

                return (
                  <div className="rounded-md border border-line-control bg-surface-raised px-2 py-1 text-[11px] shadow-lg">
                    <div className="text-tertiary">{dayLabel(point.at)}</div>
                    {series.map(({ key, label }) => (
                      <div key={key} className="flex justify-between gap-3">
                        <span className="text-secondary">{label}</span>
                        <span className="font-mono text-main">{formatTokens(point[key] ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            {series.map(({ key }, index) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="usage"
                fill={color(index)}
                // A day far below the busiest still shows that it used something.
                minPointSize={(value) => ((value ?? 0) > 0 ? 2 : 0)}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <ul aria-label={t('Chart legend')} className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {series.map(({ key, label }, index) => (
            <li key={key} className="flex min-w-0 items-center gap-1.5 text-[11px] text-secondary">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: color(index) }}
              />
              <span className="max-w-40 truncate">{label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
