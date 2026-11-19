import { LayoutGrid, Plus } from 'lucide-react'
import { useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { EmptyState } from '../../components/EmptyState'
import { Table } from '../../components/Table'
import { Button } from '../../components/ui/button'
import { useTeamRole } from '../../hooks/useTeamRole'
import { t } from '../../i18n'

import { DashboardGrid } from './DashboardGrid'
import { FormerMembersSection } from './FormerMembersSection'
import { RANGE_PRESETS, rangeLabel } from './helpers'
import { SectionHeading } from './SectionHeading'
import { useDashboardMenuItems } from './useDashboardMenuItems'
import { splitByVisibility } from './visibility'

import type { Column } from '../../components/Table'
import type { NuphosDashboard, OpenAgentChat } from '../schema'
import type { Dispatch, SetStateAction } from 'react'

type Props = {
  embedded?: boolean
  teamId: string
  loading: boolean
  dashboards: NuphosDashboard[]
  setDashboards: Dispatch<SetStateAction<NuphosDashboard[]>>
  visibleDashboards: NuphosDashboard[]
  dashboardToDelete: NuphosDashboard | null
  setDashboardToDelete: Dispatch<SetStateAction<NuphosDashboard | null>>
  createDashboard: () => Promise<void>
  deleteDashboard: (dashboard: NuphosDashboard) => Promise<void>
  onOpenAgentChat: OpenAgentChat
  onDashboardOpened?: (d: { dashboardId: string; dashboardName: string } | null) => void
}

export function DashboardListPage({
  embedded = false,
  teamId,
  loading,
  dashboards,
  setDashboards,
  visibleDashboards,
  dashboardToDelete,
  setDashboardToDelete,
  createDashboard,
  deleteDashboard,
  onOpenAgentChat,
  onDashboardOpened,
}: Props) {
  // Hooks sit above the empty-state early return so their order stays stable.
  const [menu, setMenu] = useState<{ row: NuphosDashboard; x: number; y: number } | null>(null)
  const role = useTeamRole(teamId)
  const menuItems = useDashboardMenuItems(teamId, setDashboards, setDashboardToDelete)
  const canCreate = role !== undefined // a new dashboard is personal: no team write role needed

  if (!loading && dashboards.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={t('Custom boards')}
        description={t(
          'Dashboards chart what matters to your team — cloud spend, AI usage, delivery, and system health — with panels that pull live data from Nuphos and your connected accounts. Create one and add panels, or have Nuphos build it.',
        )}
        {...(canCreate
          ? {
              primaryAction: {
                label: embedded ? t('New custom board') : t('Create dashboard'),
                icon: Plus,
                onClick: () => void createDashboard(),
              },
              agentAction: {
                label: t('Build it for me'),
                prompt:
                  'Build me a Nuphos dashboard from my connected accounts — add a useful set of panels automatically.',
              },
            }
          : {})}
        onOpenAgentChat={onOpenAgentChat}
      />
    )
  }

  const columns: Column<NuphosDashboard>[] = [
    {
      key: 'name',
      header: t('Name'),
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
      header: t('Range'),
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
      header: t('Updated'),
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
          items={menuItems(menu.row)}
        />
      )}
      {embedded && canCreate && (
        <div className="mb-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => void createDashboard()}>
            <Plus className="size-3.5" />
            {t('New custom board')}
          </Button>
        </div>
      )}
      {listSections(visibleDashboards, dashboards).map((section) => (
        <section key={section.key} className="mb-6">
          <SectionHeading title={section.title} hint={section.hint} inset={!embedded} />
          <SectionBody
            embedded={embedded}
            rows={section.rows}
            columns={columns}
            loading={loading}
            empty={section.empty}
            onOpen={(d) => onDashboardOpened?.({ dashboardId: d.id, dashboardName: d.name })}
            hasMenu={(row) => menuItems(row).length > 0}
            onMenu={(row, position) => setMenu({ row, ...position })}
          />
        </section>
      ))}
      {role === 'ADMINISTRATOR' && !embedded && (
        <FormerMembersSection
          teamId={teamId}
          columns={columns}
          setDashboards={setDashboards}
          onOpen={(d) => onDashboardOpened?.({ dashboardId: d.id, dashboardName: d.name })}
        />
      )}
      <ConfirmDialog
        open={dashboardToDelete !== null}
        title={t('Delete dashboard?')}
        description={
          dashboardToDelete
            ? t(
                '"{name}" and all of its panels, snapshots, and alerts will be permanently deleted.',
                { name: dashboardToDelete.name },
              )
            : ''
        }
        confirmLabel={t('Delete dashboard')}
        destructive
        onConfirm={() => (dashboardToDelete ? deleteDashboard(dashboardToDelete) : undefined)}
        onClose={() => setDashboardToDelete(null)}
      />
    </>
  )
}

/** The list's two sections, each with the filtered rows and what to say when it has none. */
function listSections(visible: NuphosDashboard[], all: NuphosDashboard[]) {
  const shown = splitByVisibility(visible)
  const owned = splitByVisibility(all)

  return [
    {
      key: 'personal',
      title: t('Personal'),
      hint: t('Only you can see these.'),
      rows: shown.personal,
      empty: owned.personal.length ? t('No dashboards match.') : t('No personal dashboards yet.'),
    },
    {
      key: 'team',
      title: t('Team'),
      hint: t('Everyone in the team can see these.'),
      rows: shown.team,
      empty: owned.team.length ? t('No dashboards match.') : t('No team dashboards yet.'),
    },
  ]
}

/** One section's dashboards: cards on the team home, a table on the Dashboards page. */
function SectionBody({
  embedded,
  rows,
  columns,
  loading,
  empty,
  onOpen,
  onMenu,
  hasMenu,
}: {
  embedded: boolean
  rows: NuphosDashboard[]
  columns: Column<NuphosDashboard>[]
  loading: boolean
  empty: string
  onOpen: (dashboard: NuphosDashboard) => void
  onMenu: (row: NuphosDashboard, position: { x: number; y: number }) => void
  hasMenu: (row: NuphosDashboard) => boolean
}) {
  if (!embedded) {
    return (
      <Table<NuphosDashboard>
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        onPrimaryAction={onOpen}
        onRowContextMenu={(row, e) => hasMenu(row) && onMenu(row, { x: e.clientX, y: e.clientY })}
        storageKey="cost-dashboards"
        defaultSort={{ key: 'updated', dir: 'desc' }}
        loading={loading}
        empty={empty}
      />
    )
  }
  if (!rows.length && !loading) return <p className="text-[12px] text-tertiary">{empty}</p>

  return (
    <DashboardGrid
      dashboards={rows}
      loading={loading}
      onOpen={onOpen}
      onMenu={onMenu}
      hasMenu={hasMenu}
    />
  )
}
