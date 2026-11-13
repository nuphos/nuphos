import { useId } from 'react'

import { t } from '../../i18n'

import { AGENT_USAGE_COLUMNS, AgentUsageRow } from './AgentUsageRow'
import { AgentUsageSkeleton } from './AgentUsageSkeleton'
import { PanelHeading } from './RuntimePanel'

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

/** One row per agent with where it runs and how much of its plan is left. */
function AgentUsageTable({
  instances,
  quotas,
  selectedId,
  onSelect,
}: {
  instances: readonly RuntimeInstance[]
  quotas: ReadonlyMap<string, RuntimeQuota>
  selectedId: string | null
  onSelect: (runtimeId: string) => void
}) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="@container">
      <PanelHeading id={headingId} title={t('Runtimes')} />
      <div className="overflow-hidden rounded-xl border border-line-control/60 bg-surface/40">
        <div
          className={`grid ${AGENT_USAGE_COLUMNS} border-b border-line-control/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary`}
        >
          <span>{t('Runtime')}</span>
          <span className="hidden @3xl:block">{t('Runs on')}</span>
          <span>{t('Usage')}</span>
          <span />
        </div>
        {instances.map((instance) => (
          <AgentUsageRow
            key={instance.id}
            instance={instance}
            quota={quotas.get(instance.id)}
            selected={selectedId === instance.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}

/** What the agent list shows before it has any agents: a skeleton, then a hint. */
function AgentListPlaceholder({ loading, filtered }: { loading: boolean; filtered: boolean }) {
  if (loading) return <AgentUsageSkeleton />
  // Anyone may add their own computer, so no one is sent to an administrator.
  const hint = filtered
    ? t('No matching runtimes.')
    : t('Add your first runtime to start an agent.')

  return (
    <p className="rounded-xl border border-dashed border-line-control p-8 text-center text-sm text-tertiary">
      {hint}
    </p>
  )
}
