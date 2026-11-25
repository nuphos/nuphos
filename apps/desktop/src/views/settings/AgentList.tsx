import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'

import { t } from '../../i18n'
import { runtimeFallbackQuery, useRuntimeQuotaHistoryQuery } from '../../lib/query/runtime'

import { agentDisplayName } from './agentPresentation'
import { AGENT_USAGE_COLUMNS, AgentUsageRow } from './AgentUsageRow'
import { AgentUsageSkeleton } from './AgentUsageSkeleton'
import { tickLabel } from './billingPresentation'
import { quotaHistoryRows } from './quotaHistoryRows'
import { PanelHeading } from './RuntimePanel'
import { WEEK_MS, weeklyPoints, weeklyWindow } from './weeklyPace'
import { WeeklyUsageChart } from './WeeklyUsageChart'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** The agents themselves once any have loaded, else a skeleton or a hint. */
export function AgentList({
  loading,
  filtered,
  ...table
}: Parameters<typeof AgentUsageTable>[0] & {
  loading: boolean
  filtered: boolean
}) {
  if (table.instances.length > 0) {
    return (
      <div className="t-agents-reveal">
        <AgentUsageTable {...table} />
      </div>
    )
  }

  return <AgentListPlaceholder loading={loading} filtered={filtered} />
}

/** The selected runtime's weekly chart, or the first one that reports a weekly window, above
 *  one row per runtime with how much of its plan is used and how long it sat at a limit. */
function AgentUsageTable({
  teamId,
  instances,
  quotas,
  selectedId,
  onSelect,
}: {
  teamId: string
  instances: readonly RuntimeInstance[]
  quotas: ReadonlyMap<string, RuntimeQuota>
  selectedId: string | null
  onSelect: (runtimeId: string) => void
}) {
  const headingId = useId()
  // History and fallbacks are decoration: a failed read leaves the chart and strips out.
  const { data: history } = useRuntimeQuotaHistoryQuery(teamId, '7d')
  const { data: fallbacks } = useQuery(runtimeFallbackQuery(teamId))
  const peaks = new Map(
    history
      ? quotaHistoryRows(history.series, instances, '7d', history.nowMs).map((row) => [
          row.instance.id,
          row.peak,
        ])
      : [],
  )
  const weekly = (i: RuntimeInstance) => history && weeklyWindow(quotas.get(i.id), history.nowMs)
  const charted =
    instances.find((i) => i.id === selectedId && weekly(i)) ?? instances.find((i) => weekly(i))
  const window = charted && weekly(charted)
  const fallback = charted && instances.find((i) => i.id === fallbacks?.[charted.id])

  return (
    <section aria-labelledby={headingId} className="@container">
      <PanelHeading
        id={headingId}
        title={t('Subscription usage')}
        hint={t('Weekly plan usage per runtime, last 7 days through the next reset')}
      />
      <div className="rounded-xl border border-line-control/60 bg-surface/40">
        {charted && window && history && (
          <WeeklyUsageChart
            instance={charted}
            quota={quotas.get(charted.id)}
            window={window}
            points={weeklyPoints(history.series, charted.id, window.id, history.nowMs)}
            fallbackName={fallback ? agentDisplayName(fallback) : null}
            nowMs={history.nowMs}
          />
        )}
        <div role="region" aria-label={t('Runtimes')} className="p-2">
          <div
            className={`grid ${AGENT_USAGE_COLUMNS} items-end px-3 py-2 text-[11px] text-tertiary`}
          >
            <span>{t('Runtime')}</span>
            <span>{t('Plan used now')}</span>
            <span className="hidden @3xl:block">
              {t('At limit, last 7 days')}
              {history && (
                <span className="flex justify-between font-mono text-[10px]">
                  <span>{tickLabel(history.nowMs - WEEK_MS, '7d')}</span>
                  <span>{t('Now')}</span>
                </span>
              )}
            </span>
            <span className="text-right">{t('At limit')}</span>
          </div>
          {instances.map((instance) => (
            <AgentUsageRow
              key={instance.id}
              instance={instance}
              quota={quotas.get(instance.id)}
              peak={history ? (peaks.get(instance.id) ?? []) : undefined}
              selected={selectedId === instance.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

/** What the agent list shows before it has any agents: a skeleton, then a hint. */
function AgentListPlaceholder({ loading, filtered }: { loading: boolean; filtered: boolean }) {
  if (loading) return <AgentUsageSkeleton />
  // Anyone may add their own computer, so no one is sent to an administrator.
  const hint = filtered ? t('No matching runtimes.') : t('Add your first runtime to start a task.')

  return (
    <p className="rounded-xl border border-dashed border-line-control p-8 text-center text-sm text-tertiary">
      {hint}
    </p>
  )
}
