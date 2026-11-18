import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'
import { useTeamUsageQuery } from '../../lib/query/usage'

import { HeatmapSkeleton } from './AgentUsageSkeleton'
import { RangeSwitch } from './MetricChart'
import { PanelHeading } from './RuntimePanel'
import {
  TOKEN_USAGE_GROUPS,
  TOKEN_USAGE_RANGES,
  formatUsd,
  previousTokenUsageWindow,
  tokenUsageLines,
  tokenUsageSplit,
  tokenUsageWindow,
  usageGroupLabel,
} from './tokenUsagePresentation'
import { UsageSplitChart } from './UsageSplitChart'
import { UsageTable } from './UsageTable'

import type { TokenUsageRange, UsageNames } from './tokenUsagePresentation'
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

const NOTE =
  'mt-3 rounded-xl border border-dashed border-line-control px-4 py-6 text-center text-xs leading-5 text-tertiary'

/** A row the reader clicked into: every read keeps only records with this value. */
type UsageFilter = { dimension: UsageDimension; value: string; label: string }

/** What the team's runtimes spent in model tokens, per day and split by one dimension, each
 *  group against the period before. Every member sees the team's numbers; another member's
 *  Bot, Task or conversation is named only to administrators. */
export function TokenUsage({
  teamId,
  instances,
}: {
  teamId: string
  instances: readonly RuntimeInstance[]
}) {
  const [range, setRange] = useState<TokenUsageRange>('7d')
  const [groupBy, setGroupBy] = useState<UsageDimension>('model')
  const [filter, setFilter] = useState<UsageFilter | null>(null)
  // The window moves only when the range does, so a re-render never refetches.
  const span = useMemo(() => tokenUsageWindow(range, new Date()), [range])
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const where = filter ? { [filter.dimension]: filter.value } : {}
  const days = useTeamUsageQuery(teamId, { ...span, ...where, bucket: 'day', timeZone, groupBy })
  const groups = useTeamUsageQuery(teamId, { ...span, ...where, groupBy })
  // The same days just before, so a group that grew stands out.
  const previous = useTeamUsageQuery(teamId, {
    ...previousTokenUsageWindow(span),
    ...where,
    groupBy,
  })
  // Everything else is named by the backend, which reads it inside the viewer's scope.
  const names = useMemo(
    () => ({ runtimes: new Map(instances.map((instance) => [instance.id, instance.label])) }),
    [instances],
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
        filter={filter}
        onFilter={setFilter}
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
  filter,
  onFilter,
}: {
  days: UsageAnswer
  groups: UsageAnswer
  /** Absent until read; compared only once it is for the same grouping. */
  previous: UsageAnswer | undefined
  names: UsageNames
  stale: boolean
  groupBy: UsageDimension
  onGroupBy: (groupBy: UsageDimension) => void
  filter: UsageFilter | null
  onFilter: (filter: UsageFilter | null) => void
}) {
  // Drawn by the grouping each answer was asked for, not the one being loaded.
  const shownGroup = groups.query.groupBy ?? groupBy
  const lines = tokenUsageLines(
    groups.rows,
    shownGroup,
    { ...names, served: groups.names },
    previous?.query.groupBy === shownGroup ? previous.rows : [],
  )
  const split = tokenUsageSplit(
    days.rows,
    days.query.groupBy ?? groupBy,
    { ...names, served: days.names },
    days.query,
  )
  const total = lines.reduce((sum, line) => sum + line.totalTokens, 0)
  const cost = lines.some((line) => line.costUsd !== undefined)
    ? lines.reduce((sum, line) => sum + (line.costUsd ?? 0), 0)
    : undefined

  return (
    <div aria-busy={stale} className={stale ? 'opacity-50 transition-opacity' : undefined}>
      <div className="rounded-xl border border-line-control/60 p-4">
        <UsageSplitChart series={split.series} points={split.points} total={split.total} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-xs text-tertiary">
          {filter && (
            <span className="flex min-w-0 items-center gap-1 rounded-md border border-line-control/70 py-0.5 pl-2 pr-1 text-main">
              <span className="truncate">
                {usageGroupLabel(filter.dimension)}: {filter.label}
              </span>
              <button
                type="button"
                aria-label={t('Clear filter')}
                onClick={() => onFilter(null)}
                className="rounded p-0.5 text-tertiary hover:bg-state-hover hover:text-main"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {cost === undefined ? null : t('About {cost} at list prices', { cost: formatUsd(cost) })}
        </div>
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
          total={total}
          group={shownGroup}
          // A row filters the section to itself; Group by then breaks it down further.
          onOpen={
            filter?.dimension === shownGroup
              ? undefined
              : (line) => onFilter({ dimension: shownGroup, value: line.key, label: line.label })
          }
        />
      )}
    </div>
  )
}
