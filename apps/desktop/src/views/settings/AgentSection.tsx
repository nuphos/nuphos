import './agents.css'
import { Dialog } from '@base-ui/react/dialog'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../hooks/useRuntimeQuotas'

import { AddAgentDialog } from './AddAgentDialog'
import { RuntimeInstanceCard } from './RuntimeInstanceCard'
import { RuntimeQuotaHistory } from './RuntimeQuotaHistory'

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
  // Kept apart from the selection so the panel still has its agent while it slides out.
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<HTMLDivElement | null>(null)
  const catalog = useRuntimeInstances(teamId, refreshKey)
  const quotas = useRuntimeQuotas(teamId, catalog.instances)
  const instances = catalog.instances.filter(
    (instance) =>
      instance.kind !== 'local' &&
      instance.label.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  const selected = instances.find((instance) => instance.id === selectedId)
  const select = (id: string) => {
    setSelectedId(id)
    setOpen(true)
  }

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
            onAdded={select}
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
          <div ref={setPage} className="relative min-h-0 flex-1 overflow-clip">
            {/* Block, not flex: the open panel marks this scroller inert, and the inert
                z-index would lift a flex item above the panel. The container clips rather
                than hides overflow: the panel starts off to the right as focus moves into
                it, and a hidden-overflow ancestor would scroll sideways to reveal it. */}
            <div className="h-full overflow-y-auto p-5 lg:p-8">
              <div className="mx-auto w-full max-w-5xl">
                <RuntimeQuotaHistory
                  teamId={teamId}
                  instances={instances}
                  quotas={quotas}
                  selectedId={open ? selectedId : null}
                  onSelect={select}
                />
              </div>
            </div>
            {/* Focus stays in the panel, but the page is not scroll-locked: locking it hides
                the scrollbar and shifts the overview sideways as the panel opens. */}
            <Dialog.Root
              open={open && selected !== undefined}
              onOpenChange={setOpen}
              modal="trap-focus"
            >
              <Dialog.Portal container={page}>
                <Dialog.Backdrop className="absolute inset-0 z-30 bg-black/10 transition-opacity duration-150 motion-reduce:transition-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
                <Dialog.Popup className="absolute inset-y-0 right-0 z-30 flex w-[min(680px,100%)] flex-col border-l border-zGray-800 bg-zGray-900 shadow-2xl shadow-black/20 outline-none transition-transform motion-reduce:transition-none duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:translate-x-full data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:translate-x-full">
                  <div className="flex items-center justify-end px-3 pt-3">
                    <Dialog.Title className="sr-only">{selected?.label}</Dialog.Title>
                    <Dialog.Close
                      aria-label="Close"
                      className="rounded-md p-1.5 text-tertiary outline-none hover:bg-zGray-800/60 hover:text-main focus-visible:ring-2 focus-visible:ring-zViolet-500/60"
                    >
                      <X className="h-4 w-4" />
                    </Dialog.Close>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
                    {selected && (
                      <RuntimeInstanceCard
                        key={selected.id}
                        teamId={teamId}
                        instance={selected}
                        quota={quotas.get(selected.id)}
                        isAdmin={isAdmin}
                      />
                    )}
                  </div>
                </Dialog.Popup>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        )}
      </div>
    </div>
  )
}
