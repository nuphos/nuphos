import { useState } from 'react'

import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../hooks/useRuntimeQuotas'

import { AddAgentDialog } from './AddAgentDialog'
import { RuntimeInstanceCard } from './RuntimeInstanceCard'

import type { AtlasTeam } from '../../types'

export function AgentSection({ team }: { team: AtlasTeam | undefined }) {
  const [adding, setAdding] = useState(false)
  // undefined = nothing chosen yet, so the first usable runtime opens itself;
  // null = the user collapsed everything.
  const [expandedId, setExpandedId] = useState<string | null | undefined>(undefined)
  const teamId = team?.id
  const catalog = useRuntimeInstances(teamId)
  const quotas = useRuntimeQuotas(teamId)
  const isAdmin = team?.role === 'ADMINISTRATOR'
  const instances = catalog.instances.filter((instance) => instance.kind !== 'local')
  const expanded =
    expandedId === undefined
      ? (instances.find((instance) => instance.status === 'active')?.id ?? instances[0]?.id ?? null)
      : expandedId
  const online = instances.filter((instance) => instance.status === 'active').length

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold text-main">Agents</h1>
          <p className="mt-1 text-[13px] text-tertiary">
            Where this workspace’s conversations run. Defaults apply to everyone; existing
            conversations keep their settings.
          </p>
        </div>
        {team && isAdmin && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1 shrink-0 rounded-md bg-zViolet-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-zViolet-500"
          >
            + Add agent
          </button>
        )}
      </div>
      {team && (
        <>
          {adding && (
            <AddAgentDialog
              key={team.id}
              teamId={team.id}
              onClose={() => setAdding(false)}
              onAdded={setExpandedId}
            />
          )}
          {catalog.error && (
            <div className="mb-4 flex items-center gap-3 text-sm text-error">
              {catalog.error}
              <button type="button" onClick={catalog.refresh} className="text-secondary underline">
                Retry
              </button>
            </div>
          )}
          {catalog.loading && instances.length === 0 && (
            <div aria-busy="true" className="space-y-3">
              <div className="h-16 animate-pulse rounded-xl bg-zGray-800/40" />
              <div className="h-16 animate-pulse rounded-xl bg-zGray-800/40" />
            </div>
          )}
          {!catalog.loading && !catalog.error && instances.length === 0 && (
            <p className="rounded-xl border border-dashed border-zGray-800 p-6 text-sm text-tertiary">
              {isAdmin
                ? 'Add your first agent to start a conversation.'
                : 'Ask a workspace administrator to add an agent.'}
            </p>
          )}
          {instances.length > 0 && (
            <>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-tertiary">
                {String(instances.length)} agent{instances.length === 1 ? '' : 's'}
                {online !== instances.length && ` · ${String(online)} enabled`}
              </p>
              <div className="space-y-3">
                {instances.map((instance) => (
                  <RuntimeInstanceCard
                    key={`${team.id}:${instance.id}:${instance.status}`}
                    teamId={team.id}
                    instance={instance}
                    quota={quotas.get(instance.id)}
                    isAdmin={isAdmin}
                    expanded={expanded === instance.id}
                    onToggle={() => setExpandedId(expanded === instance.id ? null : instance.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
