import './agents.css'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { usePageAside } from '../../hooks/usePageAside'
import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../hooks/useRuntimeQuotas'

import { AddAgentDialog } from './AddAgentDialog'
import { RuntimeInstanceCard } from './RuntimeInstanceCard'
import { AgentUsageSkeleton } from './AgentUsageSkeleton'
import { RuntimeQuotaHistory } from './RuntimeQuotaHistory'

import { useToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'

const PANEL_WIDTH = 'min(560px,48cqw)'
// Matches .t-agent-panel's width transition in agents.css.
const PANEL_CLOSE_MS = 300

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
  // Apart from the selection, so the panel keeps its agent while it slides shut.
  const [open, setOpen] = useState(false)
  const aside = usePageAside()
  const catalog = useRuntimeInstances(teamId, refreshKey)
  const quotas = useRuntimeQuotas(teamId, catalog.instances)
  const instances = catalog.instances.filter(
    (instance) =>
      instance.kind !== 'local' &&
      instance.label.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  // From the whole catalog, so filtering the table does not close the open panel.
  const selected = catalog.instances.find((instance) => instance.id === selectedId)
  // The control that opened the panel gets focus back when it closes.
  const opener = useRef<HTMLElement | null>(null)
  const close = () => {
    setOpen(false)
    opener.current?.focus()
  }
  // Selecting the open agent again closes its panel.
  const select = (id: string) => {
    if (open && id === selectedId) return close()
    if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement
    setSelectedId(id)
    setOpen(true)
  }
  // Escape from the overview or the panel, but not from a dialog opened on top: those
  // portal outside both and handle their own Escape, though React still bubbles it here.
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return
    if (event.currentTarget.contains(event.target as Node)) close()
  }

  const { isActive } = useWorkspaceTab()
  const panelShown = isActive && aside !== null && selected !== undefined

  useToolbarPrimaryAction(isActive && isAdmin ? 'Add agent' : null, () => setAdding(true))
  useEffect(() => {
    onCount(instances.length)
  }, [instances.length, onCount])
  useEffect(() => {
    onLoading(catalog.loading)
  }, [catalog.loading, onLoading])
  // Unmount the agent once the panel has finished sliding shut.
  useEffect(() => {
    if (open || selectedId === null) return
    const timer = setTimeout(() => setSelectedId(null), PANEL_CLOSE_MS)

    return () => clearTimeout(timer)
  }, [open, selectedId])

  return (
    <div
      onKeyDown={closeOnEscape}
      className="t-agents-page flex min-h-0 flex-1 flex-col overflow-hidden"
    >
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
        <div className="min-h-0 flex-1 overflow-hidden p-5 lg:p-8">
          <div className="mx-auto w-full max-w-5xl">
            <AgentUsageSkeleton />
          </div>
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
        <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-8">
          <div className="t-agents-reveal mx-auto w-full max-w-5xl">
            <RuntimeQuotaHistory
              teamId={teamId}
              instances={instances}
              quotas={quotas}
              selectedId={panelShown && open ? selectedId : null}
              onSelect={select}
            />
          </div>
        </div>
      )}
      {panelShown &&
        createPortal(
          // Like the dock: the aside's width eases open and shut while the panel content
          // keeps its final width, so the panel never reflows mid-animation.
          <aside
            aria-label={selected.label}
            onKeyDown={closeOnEscape}
            style={{ '--agent-panel-w': open ? PANEL_WIDTH : '0px' } as CSSProperties}
            className="t-agent-panel flex h-full shrink-0 overflow-hidden border-l border-zGray-800/60 sidebar-surface"
          >
            <div style={{ width: PANEL_WIDTH }} className="flex h-full shrink-0 flex-col">
              <div className="titlebar-drag flex h-[42px] shrink-0 items-center gap-2 border-b border-zGray-800/60 px-3">
                <button
                  type="button"
                  aria-label="Close"
                  onClick={close}
                  className="titlebar-no-drag rounded-md p-1.5 text-tertiary outline-none hover:bg-zGray-800/60 hover:text-main focus-visible:ring-2 focus-visible:ring-zViolet-500/60"
                >
                  <X className="h-4 w-4" />
                </button>
                <span className="truncate text-[12.5px] text-tertiary">Agent details</span>
              </div>
              <div
                key={selected.id}
                className="t-agent-panel-body min-h-0 flex-1 overflow-y-auto pb-6"
              >
                <RuntimeInstanceCard
                  teamId={teamId}
                  instance={selected}
                  quota={quotas.get(selected.id)}
                  isAdmin={isAdmin}
                />
              </div>
            </div>
          </aside>,
          aside,
        )}
    </div>
  )
}
