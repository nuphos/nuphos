import { useMemo, useState } from 'react'

import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'
import { useTeamUsageQuery } from '../../lib/query/usage'

import { HeatmapSkeleton } from './AgentUsageSkeleton'
import { PanelHeading } from './RuntimePanel'
import {
  TOKEN_USAGE_GROUPS,
  formatUsd,
  previousTokenUsageWindow,
  tokenUsageLines,
  tokenUsageSplit,
  tokenUsageWindow,
  usageCacheCutoff,
  filterQuery,
  toggleFilter,
} from './tokenUsagePresentation'
import { UsageFilterBar } from './UsageFilters'
import { UsageSplitChart } from './UsageSplitChart'
import { UsageTable } from './UsageTable'

import type { UsageFilters, UsageNames } from './tokenUsagePresentation'
import type { RuntimeInstance } from '../../types/runtime'
import type {
  TeamUsageNames,
  TeamUsageQuery,
  TeamUsageRow,
  UsageDimension,
} from '../../types/usage'

const NOTE =
  'mt-3 rounded-xl border border-dashed border-line-control px-4 py-6 text-center text-xs leading-5 text-tertiary'

/** What the team's runtimes spent in model tokens, per day and split by one dimension, each
 *  group against the period before. Every member sees the team's numbers; the backend names
 *  another member's Bot, Task, conversation, Trigger or computer only where the viewer may see
 *  it, and the rest show as their dimension. */
export function TokenUsage({
  teamId,
  instances,
}: {
  teamId: string
  instances: readonly RuntimeInstance[]
}) {
  const [groupBy, setGroupBy] = useState<UsageDimension>('model')
  const [filters, setFilters] = useState<UsageFilters>({})
  // Fixed on mount, so a re-render never refetches.
  const span = useMemo(() => tokenUsageWindow(new Date()), [])
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const where = filterQuery(filters)
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
        // The last grouping stays on screen, dimmed, until the new one arrives.
        stale={groups.isPlaceholderData || days.isPlaceholderData}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        teamId={teamId}
        span={span}
        filters={filters}
        onFilters={setFilters}
      />
    )

  return (
    <section className="@container mt-6" aria-label={t('Token usage')}>
      <PanelHeading
        title={t('Token usage')}
        hint={t(
          'Tokens the team’s runtimes reported. Input includes cached tokens; cost is estimated at list prices. Before {date}, Input left out cached tokens; Total included them.',
          { date: usageCacheCutoff() },
        )}
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
  teamId,
  span,
  filters,
  onFilters,
}: {
  days: UsageAnswer
  groups: UsageAnswer
  /** Absent until read; compared only once it is for the same grouping. */
  previous: UsageAnswer | undefined
  names: UsageNames
  stale: boolean
  groupBy: UsageDimension
  onGroupBy: (groupBy: UsageDimension) => void
  teamId: string
  span: { from: string; to: string }
  filters: UsageFilters
  onFilters: (filters: UsageFilters) => void
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
        <UsageFilterBar
          teamId={teamId}
          span={span}
          names={names}
          filters={filters}
          onChange={onFilters}
        />
        <div className="flex items-center gap-3 text-xs text-tertiary">
          {cost === undefined ? null : t('About {cost} at list prices', { cost: formatUsd(cost) })}
          <AppSelect
            size="sm"
            ariaLabel={t('Group by')}
            value={groupBy}
            onValueChange={(value) => onGroupBy(value as UsageDimension)}
            options={[...TOKEN_USAGE_GROUPS]}
          />
        </div>
      </div>
      {lines.length === 0 ? (
        <p className={NOTE}>{t('No token usage recorded in this range yet.')}</p>
      ) : (
        <UsageTable
          lines={lines}
          total={total}
          group={shownGroup}
          // A row adds itself to the filters; Group by then breaks it down further.
          onOpen={(line) =>
            onFilters(toggleFilter(filters, shownGroup, { value: line.key, label: line.label }))
          }
        />
      )}
    </div>
  )
}
