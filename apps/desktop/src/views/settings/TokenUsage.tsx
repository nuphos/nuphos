import { useMemo, useState } from 'react'

import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'
import { useTeamMembers } from '../../lib/bindingAccess'
import { useTeamUsageQuery } from '../../lib/query/usage'

import { MetricChart, RangeSwitch } from './MetricChart'
import { PanelHeading } from './RuntimePanel'
import {
  TOKEN_USAGE_GROUPS,
  TOKEN_USAGE_RANGES,
  formatTokens,
  formatUsd,
  tokenUsageDays,
  tokenUsageLines,
  tokenUsageWindow,
} from './tokenUsagePresentation'

import type { TokenUsageRange } from './tokenUsagePresentation'
import type { RuntimeInstance } from '../../types/runtime'
import type { UsageDimension } from '../../types/usage'

const RANGE_OPTIONS = (Object.keys(TOKEN_USAGE_RANGES) as TokenUsageRange[]).map((value) => ({
  value,
  label: TOKEN_USAGE_RANGES[value].label,
}))

const COLUMNS = 'grid-cols-[minmax(0,1fr)_repeat(5,minmax(4.5rem,auto))]'

/** What the team's runtimes spent in model tokens, per day and split by one dimension.
 *  An administrator sees the whole team; anyone else their own conversations. */
export function TokenUsage({
  teamId,
  instances,
}: {
  teamId: string
  instances: readonly RuntimeInstance[]
}) {
  const [range, setRange] = useState<TokenUsageRange>('7d')
  const [groupBy, setGroupBy] = useState<UsageDimension>('model')
  // The window moves only when the range does, so a re-render never refetches.
  const span = useMemo(() => tokenUsageWindow(range, new Date()), [range])
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const days = useTeamUsageQuery(teamId, { ...span, bucket: 'day', timeZone })
  const groups = useTeamUsageQuery(teamId, { ...span, groupBy })
  const members = useTeamMembers(teamId)
  const names = useMemo(
    () => ({
      members: new Map(members.map((member) => [member.id, member.name || member.email])),
      runtimes: new Map(instances.map((instance) => [instance.id, instance.label])),
    }),
    [members, instances],
  )
  const lines = groups.data ? tokenUsageLines(groups.data, groupBy, names) : []
  const total = lines.reduce((sum, line) => sum + line.totalTokens, 0)
  const cost = lines.some((line) => line.costUsd !== undefined)
    ? lines.reduce((sum, line) => sum + (line.costUsd ?? 0), 0)
    : undefined

  return (
    <section className="@container mt-6" aria-label={t('Token usage')}>
      <PanelHeading
        title={t('Token usage')}
        hint={t(
          'Tokens the team’s runtimes reported. Input includes cached tokens; cost is estimated at list prices.',
        )}
        right={
          <RangeSwitch
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            label={t('Time range')}
          />
        }
      />
      <div className="rounded-xl border border-line-control/60 p-4">
        <MetricChart
          title={t('Tokens per day')}
          data={days.data ? tokenUsageDays(days.data, span) : []}
          format={formatTokens}
          timeLabel={(at) =>
            new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          }
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-tertiary">
          {t('{tokens} tokens', { tokens: formatTokens(total) })}
          {cost === undefined ? null : ` · ${t('about {cost}', { cost: formatUsd(cost) })}`}
        </span>
        <AppSelect
          size="sm"
          ariaLabel={t('Group by')}
          value={groupBy}
          onValueChange={(value) => setGroupBy(value as UsageDimension)}
          options={[...TOKEN_USAGE_GROUPS]}
        />
      </div>
      {groups.data && lines.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line-control px-4 py-6 text-center text-xs leading-5 text-tertiary">
          {t('No token usage recorded in this range yet.')}
        </p>
      ) : (
        <div role="table" aria-label={t('Token usage by group')} className="mt-3 text-xs">
          <div
            role="row"
            className={`grid ${COLUMNS} gap-3 border-b border-line-control/60 pb-2 text-tertiary`}
          >
            <span role="columnheader">
              {TOKEN_USAGE_GROUPS.find((g) => g.value === groupBy)?.label}
            </span>
            <span role="columnheader" className="text-right">
              {t('Input')}
            </span>
            <span role="columnheader" className="text-right">
              {t('Cached')}
            </span>
            <span role="columnheader" className="text-right">
              {t('Output')}
            </span>
            <span role="columnheader" className="text-right">
              {t('Total')}
            </span>
            <span role="columnheader" className="text-right">
              {t('Est. cost')}
            </span>
          </div>
          {lines.map((line) => (
            <div
              key={line.key}
              role="row"
              className={`grid ${COLUMNS} gap-3 border-b border-line-control/30 py-2 text-main`}
            >
              <span role="cell" className="truncate" title={line.label}>
                {line.label}
              </span>
              <span role="cell" className="text-right font-mono">
                {formatTokens(line.inputTokens)}
              </span>
              <span role="cell" className="text-right font-mono">
                {formatTokens(line.cachedInputTokens)}
              </span>
              <span role="cell" className="text-right font-mono">
                {formatTokens(line.outputTokens)}
              </span>
              <span role="cell" className="text-right font-mono">
                {formatTokens(line.totalTokens)}
              </span>
              <span role="cell" className="text-right font-mono">
                {line.costUsd === undefined ? '—' : formatUsd(line.costUsd)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
