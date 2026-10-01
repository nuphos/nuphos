import { Clock, Plus } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import { EmptyState } from '../../components/EmptyState'
import { Table } from '../../components/Table'
import { applyFilter } from '../cloud/shared'

import { buildTriggerColumns } from './triggerColumns'
import { buildTriggerRows, filterTriggerRows, rowSearchText } from './triggerRows'

import type { TriggerListRow, TriggerStatusFilter, TriggerTypeFilter } from './triggerRows'
import type { AgentTrigger, AgentTriggerGroup } from '../../api'
import type { TeamMember } from '../../types'

export type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; triggers: AgentTrigger[]; groups: AgentTriggerGroup[] }
  | { kind: 'error'; message: string }

type ListProps = {
  state: ListState
  onRetry: () => void
  canManage: boolean
  members: TeamMember[]
  /** The workspace toolbar's shared search box. */
  filter: string
  typeFilter: TriggerTypeFilter
  statusFilter: TriggerStatusFilter
  /** "Runs as" narrowed to one member; null lists everyone. */
  principalFilter: string | null
  /** The row whose toggle is mid-flight. */
  togglingKey: string | null
  onRowsChange?: (count: number) => void
  onOpen: (row: TriggerListRow) => void
  onRowMenu: (row: TriggerListRow, at: { clientX: number; clientY: number }) => void
  onToggle: (row: TriggerListRow, enabled: boolean) => void
  /** Open the create-trigger form — the empty state's primary action. */
  onCreate: () => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function TriggersList({
  state,
  onRetry,
  canManage,
  members,
  filter,
  typeFilter,
  statusFilter,
  principalFilter,
  togglingKey,
  onRowsChange,
  onOpen,
  onRowMenu,
  onToggle,
  onCreate,
  onOpenAgentChat,
}: ListProps) {
  const rows = useMemo(() => {
    if (state.kind !== 'ready') return []
    const all = buildTriggerRows(state.triggers, state.groups)

    return applyFilter(
      filterTriggerRows(all, {
        type: typeFilter,
        status: statusFilter,
        principalId: principalFilter,
      }),
      filter,
      rowSearchText,
    )
  }, [state, filter, typeFilter, statusFilter, principalFilter])

  useEffect(() => {
    onRowsChange?.(rows.length)
  }, [rows.length, onRowsChange])

  const columns = useMemo(
    () => buildTriggerColumns({ members, canManage, togglingKey, onToggle }),
    [members, canManage, togglingKey, onToggle],
  )

  if (state.kind === 'error') {
    return (
      <div className="p-5 text-[12.5px] text-error">
        {state.message}
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 underline text-secondary hover:text-main"
        >
          Retry
        </button>
      </div>
    )
  }

  if (state.kind === 'ready' && state.triggers.length === 0 && state.groups.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="Triggers"
        description="Triggers run the agent on a schedule or in response to a webhook. Create one to automate recurring work."
        primaryAction={
          canManage ? { label: 'New trigger', icon: Plus, onClick: onCreate } : undefined
        }
        agentAction={{
          label: 'Set up a trigger for me',
          prompt:
            'Set up an agent trigger for me — ask me what should run and when, then create it.',
        }}
        onOpenAgentChat={onOpenAgentChat}
      />
    )
  }

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      onPrimaryAction={onOpen}
      onRowContextMenu={onRowMenu}
      loading={state.kind === 'loading'}
      storageKey="triggers"
      defaultSort={{ key: 'name', dir: 'asc' }}
      empty="No triggers match the current search or filters."
    />
  )
}
