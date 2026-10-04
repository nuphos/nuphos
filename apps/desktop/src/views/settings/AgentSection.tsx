import './agents.css'
import { useEffect, useState } from 'react'
import { Bot, ChevronRight } from 'lucide-react'
import { ClaudeCodeIcon, CodexIcon } from '../../components/agent/panel/icons'

import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../hooks/useRuntimeQuotas'

import { AddAgentDialog } from './AddAgentDialog'
import { RuntimeInstanceCard } from './RuntimeInstanceCard'

import { useToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'

export function AgentSection({
  teamId,
  isAdmin,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: {
  teamId: string
  isAdmin: boolean
  filter: string
  refreshKey: number
  onCount: (count: number) => void
  onLoading: (loading: boolean) => void
}) {
  const [adding, setAdding] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const catalog = useRuntimeInstances(teamId, refreshKey)
  const quotas = useRuntimeQuotas(teamId, catalog.instances)
  const instances = catalog.instances.filter(
    (instance) =>
      instance.kind !== 'local' &&
      instance.label.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  const selected = instances.find((instance) => instance.id === selectedId)
  const online = instances.filter((instance) => instance.status === 'active').length

  const { isActive } = useWorkspaceTab()

  useToolbarPrimaryAction(isActive && isAdmin ? 'Add agent' : null, () => setAdding(true))
  useEffect(() => {
    onCount(instances.length)
  }, [instances.length, onCount])
  useEffect(() => {
    onLoading(catalog.loading)
  }, [catalog.loading, onLoading])

  return (
    <div className="t-agents-page flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col">
        {adding && (
          <AddAgentDialog
            key={teamId}
            teamId={teamId}
            onClose={() => setAdding(false)}
            onAdded={setSelectedId}
          />
        )}
        {catalog.error && (
          <div className="m-4 flex items-center gap-3 rounded-lg border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">
            {catalog.error}
            <button type="button" onClick={catalog.refresh} className="text-secondary underline">
              Retry
            </button>
          </div>
        )}
        {catalog.loading && instances.length === 0 && (
          <div aria-busy="true" className="w-64 space-y-3 p-4">
            <div className="h-16 animate-pulse motion-reduce:animate-none rounded-xl bg-zGray-800/40" />
            <div className="h-16 animate-pulse motion-reduce:animate-none rounded-xl bg-zGray-800/40" />
          </div>
        )}
        {!catalog.loading && !catalog.error && instances.length === 0 && (
          <p className="m-6 rounded-xl border border-dashed border-zGray-800 p-8 text-center text-sm text-tertiary">
            {filter.trim()
              ? 'No matching agents.'
              : isAdmin
                ? 'Add your first agent to start a conversation.'
                : 'Ask a workspace administrator to add an agent.'}
          </p>
        )}
        {instances.length > 0 && (
          <>
            <div className="flex min-h-0 flex-1">
              <nav
                aria-label="Agents"
                className="flex w-56 shrink-0 flex-col border-r border-zGray-800/60 bg-surface/40 lg:w-72"
              >
                <div className="flex items-center justify-between px-5 py-4 text-[11px] text-tertiary">
                  <span className="font-medium tracking-wide">{instances.length} agents</span>
                  <span>{online} enabled</span>
                </div>
                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-4">
                  {instances.map((instance) => {
                    const Icon = instance.provider === 'codex' ? CodexIcon : ClaudeCodeIcon
                    const selected = selectedId === instance.id

                    return (
                      <button
                        key={instance.id}
                        type="button"
                        aria-current={selected ? 'page' : undefined}
                        onClick={() => setSelectedId(instance.id)}
                        className={`t-agents-row group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-zViolet-500/60 ${selected ? 'border-zViolet-500/25 bg-zViolet-500/[0.07] text-main shadow-sm' : 'border-transparent text-secondary hover:bg-zGray-800/40'}`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-zViolet-500/20 bg-main' : 'border-zGray-800/70 bg-main/60'}`}
                        >
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {instance.label}
                          </span>
                          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-tertiary">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${instance.status === 'active' ? 'bg-zViolet-400' : 'bg-zGray-600'}`}
                            />
                            {instance.kind === 'managed'
                              ? 'Cloud'
                              : instance.kind === 'external'
                                ? 'Self-hosted'
                                : 'Development'}
                            {instance.status !== 'active' && ' · Disabled'}
                          </span>
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-zViolet-400' : 'text-tertiary opacity-0 group-hover:opacity-60'}`}
                        />
                      </button>
                    )
                  })}
                </div>
              </nav>
              <div className="min-w-0 flex-1 overflow-y-auto p-5 lg:p-8">
                <div
                  key={selected?.id ?? 'empty'}
                  className="t-panel-slide t-agents-detail h-full"
                  data-open="true"
                >
                  {selected ? (
                    <RuntimeInstanceCard
                      key={selected.id}
                      teamId={teamId}
                      instance={selected}
                      quota={quotas.get(selected.id)}
                      isAdmin={isAdmin}
                    />
                  ) : (
                    <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 pb-12 text-center">
                      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-zGray-800/70 bg-surface shadow-sm">
                        <Bot className="h-6 w-6 text-tertiary" strokeWidth={1.5} />
                      </div>
                      <p className="text-sm font-medium text-secondary">Select an agent</p>
                      <p className="mt-2 max-w-64 text-xs leading-5 text-tertiary">
                        View usage, model settings, and runtime details.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
