import { LayoutGrid, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { EmptyState } from '../../components/EmptyState'
import { Table } from '../../components/Table'

import { RANGE_PRESETS, rangeLabel } from './helpers'

import type { Column } from '../../components/Table'
import type { NuphosDashboard, OpenAgentChat } from '../schema'
import type { Dispatch, SetStateAction } from 'react'

type Props = {
  loading: boolean
  dashboards: NuphosDashboard[]
  visibleDashboards: NuphosDashboard[]
  dashboardToDelete: NuphosDashboard | null
  setDashboardToDelete: Dispatch<SetStateAction<NuphosDashboard | null>>
  createDashboard: () => Promise<void>
  deleteDashboard: (dashboard: NuphosDashboard) => Promise<void>
  onOpenAgentChat: OpenAgentChat
  onDashboardOpened?: (d: { dashboardId: string; dashboardName: string } | null) => void
}

export function DashboardListPage({
  loading,
  dashboards,
  visibleDashboards,
  dashboardToDelete,
  setDashboardToDelete,
  createDashboard,
  deleteDashboard,
  onOpenAgentChat,
  onDashboardOpened,
}: Props) {
  // Declared above the empty-state early return so the hook order stays stable.
  const [menu, setMenu] = useState<{ row: NuphosDashboard; x: number; y: number } | null>(null)

  if (!loading && dashboards.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Dashboards"
        description="Dashboards chart what matters to your team — cloud spend, AI usage, delivery, and system health — with panels that pull live data from Nuphos and your connected accounts. Create one and add panels, or have the agent build it."
        primaryAction={{
          label: 'Create dashboard',
          icon: Plus,
          onClick: () => void createDashboard(),
        }}
        agentAction={{
          label: 'Build it for me',
          prompt:
            'Build me a Nuphos dashboard from my connected accounts — add a useful set of panels automatically.',
        }}
        onOpenAgentChat={onOpenAgentChat}
      />
    )
  }

  const columns: Column<NuphosDashboard>[] = [
    {
      key: 'name',
      header: 'Name',
      sortAccessor: (d) => d.name.toLowerCase(),
      render: (d) => (
        <span className="inline-flex items-center gap-2 text-main">
          <LayoutGrid className="h-3.5 w-3.5 text-tertiary" />
          <span className="truncate">{d.name}</span>
        </span>
      ),
    },
    {
      key: 'range',
      header: 'Range',
      width: 160,
      sortAccessor: (d) => d.rangePreset ?? d.timeRange.periodStart,
      render: (d) => (
        <span className="text-tertiary text-[12px]">
          {d.rangePreset
            ? (RANGE_PRESETS.find((p) => p.key === d.rangePreset)?.label ??
              rangeLabel(d.timeRange.periodStart, d.timeRange.periodEnd))
            : rangeLabel(d.timeRange.periodStart, d.timeRange.periodEnd)}
        </span>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      width: 160,
      sortAccessor: (d) => d.updatedAt,
      render: (d) => (
        <span className="text-tertiary font-mono text-[12px]">
          {new Date(d.updatedAt).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'delete',
              label: 'Delete dashboard',
              icon: Trash2,
              destructive: true,
              // Confirmation is the richer ConfirmDialog below, not the menu's
              // own one-line prompt — it spells out what else gets deleted.
              onSelect: () => setDashboardToDelete(menu.row),
            },
          ]}
        />
      )}
      <Table<NuphosDashboard>
        columns={columns}
        rows={visibleDashboards}
        rowKey={(d) => d.id}
        onPrimaryAction={(d) => onDashboardOpened?.({ dashboardId: d.id, dashboardName: d.name })}
        onRowContextMenu={(row, e) => setMenu({ row, x: e.clientX, y: e.clientY })}
        storageKey="cost-dashboards"
        defaultSort={{ key: 'updated', dir: 'desc' }}
        loading={loading}
        empty="No dashboards match."
      />
      <ConfirmDialog
        open={dashboardToDelete !== null}
        title="Delete dashboard?"
        description={
          dashboardToDelete
            ? `"${dashboardToDelete.name}" and all of its panels, snapshots, insights, and alerts will be permanently deleted.`
            : ''
        }
        confirmLabel="Delete dashboard"
        destructive
        onConfirm={() => (dashboardToDelete ? deleteDashboard(dashboardToDelete) : undefined)}
        onClose={() => setDashboardToDelete(null)}
      />
    </>
  )
}
