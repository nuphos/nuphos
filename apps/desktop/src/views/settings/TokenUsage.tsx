import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'
import { teamRosterQuery } from '../../lib/query/team'
import { useTeamUsageQuery } from '../../lib/query/usage'

import { HeatmapSkeleton } from './AgentUsageSkeleton'
import { MetricChart, RangeSwitch } from './MetricChart'
import { PanelHeading } from './RuntimePanel'
import {
  TOKEN_USAGE_GROUPS,
  TOKEN_USAGE_RANGES,
  formatChange,
  formatTokens,
  formatUsd,
  previousTokenUsageWindow,
  tokenUsageDays,
  tokenUsageLines,
  tokenUsageWindow,
} from './tokenUsagePresentation'

import type { TokenUsageLine, TokenUsageRange, UsageNames } from './tokenUsagePresentation'
import type { RuntimeInstance } from '../../types/runtime'
import type {
  TeamUsageNames,
  TeamUsageQuery,
  TeamUsageRow,
  UsageDimension,
} from '../../types/usage'

const RANGE_OPTIONS = (Object.keys(TOKEN_USAGE_RANGES) as TokenUsageRange[]).map((value) => ({
  value,
  label: TOKEN_USAGE_RANGES[value].label,
}))

const COLUMNS = 'grid-cols-[minmax(0,1fr)_repeat(6,minmax(4.5rem,auto))]'
const NOTE =
  'mt-3 rounded-xl border border-dashed border-line-control px-4 py-6 text-center text-xs leading-5 text-tertiary'

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
  // The same days just before, so a group that grew stands out.
  const previous = useTeamUsageQuery(teamId, { ...previousTokenUsageWindow(span), groupBy })
  // People who left still name their usage.
  const { data: roster = [] } = useQuery(teamRosterQuery(teamId))
  const names = useMemo(
    () => ({
      members: new Map(roster.map((member) => [member.id, member.name || member.email])),
      runtimes: new Map(instances.map((instance) => [instance.id, instance.label])),
    }),
    [roster, instances],
  )
  const failed = (groups.isError || days.isError) && !(groups.data && days.data)
  let body

  if (failed)
    body = (
      <div role="alert" className={NOTE}>
        <p>{t('Couldn’t load token usage.')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => void Promise.all([groups.refetch(), days.refetch()])}
        >
          {t('Try again')}
        </Button>
      </div>
    )
  else if (!groups.data || !days.data)
    body = (
      <div aria-busy="true" aria-label={t('Loading token usage')}>
        <HeatmapSkeleton rows={3} />
      </div>
    )
  else
    body = (
      <UsageReport
        days={days.data}
        groups={groups.data}
        previous={previous.data}
        names={names}
        // The last range or grouping stays on screen, dimmed, until the new one arrives.
        stale={groups.isPlaceholderData || days.isPlaceholderData}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
      />
    )

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
      {body}
    </section>
  )
}

type UsageAnswer = { query: TeamUsageQuery; rows: TeamUsageRow[]; names: TeamUsageNames }

function UsageReport({
  days,
  groups,
  previous,
  names,
  stale,
  groupBy,
  onGroupBy,
}: {
  days: UsageAnswer
  groups: UsageAnswer
  /** Absent until read; compared only once it is for the same grouping. */
  previous: UsageAnswer | undefined
  names: UsageNames
  stale: boolean
  groupBy: UsageDimension
  onGroupBy: (groupBy: UsageDimension) => void
}) {
  // Labelled by the grouping the shown rows were asked for, not the one being loaded.
  const shownGroup = groups.query.groupBy ?? groupBy
  const lines = tokenUsageLines(
    groups.rows,
    shownGroup,
    { ...names, served: groups.names },
    previous?.query.groupBy === shownGroup ? previous.rows : [],
  )
  const points = tokenUsageDays(days.rows, days.query)
  const total = points.reduce((sum, point) => sum + point.value, 0)
  const cost = lines.some((line) => line.costUsd !== undefined)
    ? lines.reduce((sum, line) => sum + (line.costUsd ?? 0), 0)
    : undefined

  return (
    <div aria-busy={stale} className={stale ? 'opacity-50 transition-opacity' : undefined}>
      <div className="rounded-xl border border-line-control/60 p-4">
        <MetricChart
          title={t('Tokens per day')}
          headline={t('{tokens} tokens', { tokens: formatTokens(total) })}
          data={points}
          format={formatTokens}
          timeLabel={(at) =>
            new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          }
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-tertiary">
          {cost === undefined ? null : t('About {cost} at list prices', { cost: formatUsd(cost) })}
        </span>
        <AppSelect
          size="sm"
          ariaLabel={t('Group by')}
          value={groupBy}
          onValueChange={(value) => onGroupBy(value as UsageDimension)}
          options={[...TOKEN_USAGE_GROUPS]}
        />
      </div>
      {lines.length === 0 ? (
        <p className={NOTE}>{t('No token usage recorded in this range yet.')}</p>
      ) : (
        <UsageTable
          lines={lines}
          groupLabel={TOKEN_USAGE_GROUPS.find((g) => g.value === shownGroup)?.label ?? ''}
        />
      )}
    </div>
  )
}

function UsageTable({ lines, groupLabel }: { lines: TokenUsageLine[]; groupLabel: string }) {
  const amount = 'text-right font-mono'

  return (
    <div role="table" aria-label={t('Token usage by group')} className="mt-3 text-xs">
      <div
        role="row"
        className={`grid ${COLUMNS} gap-3 border-b border-line-control/60 pb-2 text-tertiary`}
      >
        <span role="columnheader">{groupLabel}</span>
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
          {t('vs previous')}
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
          <span role="cell" className={amount}>
            {formatTokens(line.inputTokens)}
          </span>
          <span role="cell" className={amount}>
            {formatTokens(line.cachedInputTokens)}
          </span>
          <span role="cell" className={amount}>
            {formatTokens(line.outputTokens)}
          </span>
          <span role="cell" className={amount}>
            {formatTokens(line.totalTokens)}
          </span>
          <span role="cell" className={amount}>
            {formatChange(line)}
          </span>
          <span role="cell" className={amount}>
            {line.costUsd === undefined ? '—' : formatUsd(line.costUsd)}
          </span>
        </div>
      ))}
    </div>
  )
}
