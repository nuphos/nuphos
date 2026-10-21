import { useId } from 'react'

import { AGENT_USAGE_COLUMNS, AgentUsageRow } from './AgentUsageRow'
import { AgentUsageSkeleton } from './AgentUsageSkeleton'
import { PanelHeading } from './RuntimePanel'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** The agents themselves once any have loaded, else a skeleton or a hint. */
export function AgentList({
  loading,
  filtered,
  isAdmin,
  ...table
}: Parameters<typeof AgentUsageTable>[0] & {
  loading: boolean
  filtered: boolean
  isAdmin: boolean
}) {
  if (table.instances.length > 0) {
    return (
      <div className="t-agents-reveal">
        <AgentUsageTable {...table} />
      </div>
    )
  }

  return <AgentListPlaceholder loading={loading} filtered={filtered} isAdmin={isAdmin} />
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
      <PanelHeading id={headingId} title="Agents" />
      <div className="overflow-hidden rounded-xl border border-zGray-800/60 bg-surface/40">
        <div
          className={`grid ${AGENT_USAGE_COLUMNS} border-b border-zGray-800/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary`}
        >
          <span>Agent</span>
          <span className="hidden @3xl:block">Runs on</span>
          <span>Usage</span>
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
function AgentListPlaceholder({
  loading,
  filtered,
  isAdmin,
}: {
  loading: boolean
  filtered: boolean
  isAdmin: boolean
}) {
  if (loading) return <AgentUsageSkeleton />
  let hint = 'Ask a workspace administrator to add an agent.'

  if (filtered) hint = 'No matching agents.'
  else if (isAdmin) hint = 'Add your first agent to start a conversation.'

  return (
    <p className="rounded-xl border border-dashed border-zGray-800 p-8 text-center text-sm text-tertiary">
      {hint}
    </p>
  )
}
