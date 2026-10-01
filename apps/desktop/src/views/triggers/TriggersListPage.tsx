import { useState } from 'react'
import { createPortal } from 'react-dom'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { toast } from '../../components/ui/toast'
import { useToolbarSlot } from '../../hooks/useToolbarControls'

import { FilterTabs, PrincipalFilter } from './triggerFilters'
import { testFireTrigger } from './triggerFormActions'
import { TriggerDeleteDialog } from './TriggerFormPanels'
import { deleteTriggerRow } from './triggerRowDelete'
import { buildTriggerRowMenu } from './triggerRowMenu'
import { buildTriggerRows, rowPrincipalIds, STATUS_TABS, TYPE_TABS } from './triggerRows'
import { TriggersList } from './TriggersList'

import type { TriggerListRow, TriggerStatusFilter, TriggerTypeFilter } from './triggerRows'
import type { ListState } from './TriggersList'
import type { TeamMember } from '../../types'

/**
 * The Triggers list, with the controls that belong to it.
 *
 * Type and status ride the shared workspace toolbar beside its search box
 * rather than a header band of their own — the same place Memories and Members
 * put theirs, and the search box is already wired to filter this list.
 */
export function TriggersListPage({
  state,
  setState,
  teamId,
  members,
  canManage,
  canDelete,
  filter,
  isActive,
  onCount,
  onRetry,
  onOpenTrigger,
  onOpenGroup,
  onEditTrigger,
  onCreate,
  onOpenAgentChat,
}: {
  state: ListState
  setState: React.Dispatch<React.SetStateAction<ListState>>
  teamId?: string
  members: TeamMember[]
  canManage: boolean
  canDelete: boolean
  filter: string
  /** A keep-alive'd background tab must not leak its controls into the toolbar. */
  isActive: boolean
  onCount?: (n: number) => void
  onRetry: () => void
  /** The name travels with the id: it becomes the breadcrumb's last segment. */
  onOpenTrigger: (triggerId: string, triggerName: string) => void
  /** The name travels with the id, for the breadcrumb. */
  onOpenGroup: (groupId: string, name: string) => void
  onEditTrigger: (triggerId: string, name: string) => void
  /** Open the create-trigger form — the empty state's primary action. */
  onCreate: () => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}) {
  const [typeFilter, setTypeFilter] = useState<TriggerTypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<TriggerStatusFilter>('all')
  const [principalFilter, setPrincipalFilter] = useState<string | null>(null)
  const [togglingKey, setTogglingKey] = useState<string | null>(null)
  const [firing, setFiring] = useState(false)
  const [menu, setMenu] = useState<{ row: TriggerListRow; x: number; y: number } | null>(null)
  // The row awaiting a delete confirmation. Deleting from a list is a step
  // removed from the thing being deleted, so the dialog restates what goes —
  // provider cleanup included — exactly as the settings page does.
  const [confirmDelete, setConfirmDelete] = useState<TriggerListRow | null>(null)
  const controlsSlot = useToolbarSlot('left', isActive && state.kind === 'ready')
  // Offered owners come from the whole list, not the filtered view, so the
  // menu doesn't reshuffle as you flip the Type and status chips.
  const principalIds =
    state.kind === 'ready' ? rowPrincipalIds(buildTriggerRows(state.triggers, state.groups)) : []

  const toggleRow = async (row: TriggerListRow, enabled: boolean) => {
    setTogglingKey(row.key)
    try {
      if (row.kind === 'trigger') {
        const updated = await api.agentUpdateTrigger(row.trigger.id, { enabled }, teamId)

        setState((prev) =>
          prev.kind === 'ready'
            ? {
                ...prev,
                triggers: prev.triggers.map((t) =>
                  t.id === row.trigger.id ? { ...t, ...updated } : t,
                ),
              }
            : prev,
        )

        return
      }
      const updatedGroup = await api.agentUpdateTriggerGroup(
        row.group.id,
        { enabled },
        row.group.teamId,
      )
      // A group's partition triggers flip with it; mirror that locally so the
      // row doesn't have to wait for a refetch to look right.
      const partitionIds = new Set(row.group.partitions.map((partition) => partition.triggerId))

      setState((prev) =>
        prev.kind === 'ready'
          ? {
              kind: 'ready',
              triggers: prev.triggers.map((t) => (partitionIds.has(t.id) ? { ...t, enabled } : t)),
              groups: prev.groups.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)),
            }
          : prev,
      )
    } catch (err) {
      toast.apiError(
        row.kind === 'group' ? 'Could not update Watch group' : 'Could not update trigger',
        err,
        { fallback: 'Check your connection and try again.' },
      )
      onRetry()
    } finally {
      setTogglingKey(null)
    }
  }

  const buildMenu = (row: TriggerListRow) =>
    buildTriggerRowMenu(row, {
      canManage,
      canDelete,
      firing,
      onOpenGroup,
      onEditTrigger,
      onRunNow: (target) =>
        target.kind === 'trigger'
          ? void testFireTrigger({
              triggerId: target.trigger.id,
              teamId,
              canManage,
              setFiring,
            })
          : undefined,
      onDelete: setConfirmDelete,
    })

  const runDelete = async () => {
    if (!confirmDelete) return
    await deleteTriggerRow(confirmDelete, {
      teamId,
      canDelete,
      setState,
      onRetry,
      onSettled: () => setConfirmDelete(null),
    })
  }

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.row)}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmDelete?.kind === 'trigger' && (
        <TriggerDeleteDialog
          open
          loaded={confirmDelete.trigger}
          onClose={() => setConfirmDelete(null)}
          onConfirm={runDelete}
        />
      )}
      {confirmDelete?.kind === 'group' && (
        <ConfirmDialog
          open
          title="Remove Watch group?"
          description={`"${confirmDelete.group.name}" and its ${String(confirmDelete.group.partitionCount)} shared provider ingress${confirmDelete.group.partitionCount === 1 ? '' : 'es'} will be removed. Nuphos will clean up every recorded provider resource and preserve unrelated notification destinations.`}
          confirmLabel="Remove group"
          destructive
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void runDelete()}
        />
      )}
      {controlsSlot &&
        createPortal(
          <div className="flex items-center gap-1">
            <FilterTabs tabs={TYPE_TABS} value={typeFilter} onChange={setTypeFilter} />
            <div className="mx-1 h-4 w-px bg-zGray-800" />
            <FilterTabs tabs={STATUS_TABS} value={statusFilter} onChange={setStatusFilter} />
            <div className="mx-1 h-4 w-px bg-zGray-800" />
            <PrincipalFilter
              members={members}
              principalIds={principalIds}
              value={principalFilter}
              onChange={setPrincipalFilter}
            />
          </div>,
          controlsSlot,
        )}
      <TriggersList
        state={state}
        onRetry={onRetry}
        canManage={canManage}
        members={members}
        filter={filter}
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        principalFilter={principalFilter}
        togglingKey={togglingKey}
        onRowsChange={onCount}
        onOpen={(row) =>
          row.kind === 'group'
            ? onOpenGroup(row.group.id, row.group.name)
            : onOpenTrigger(row.trigger.id, row.trigger.name)
        }
        onRowMenu={(row, at) => setMenu({ row, x: at.clientX, y: at.clientY })}
        onToggle={(row, enabled) => void toggleRow(row, enabled)}
        onCreate={onCreate}
        onOpenAgentChat={onOpenAgentChat}
      />
    </>
  )
}
