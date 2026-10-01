import { faEye, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Cloud, HeartPulse } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { BulkActionBar } from '../components/BulkActionBar'
import { ContextMenu } from '../components/ContextMenu'
import { EmptyState } from '../components/EmptyState'
import { Table } from '../components/Table'
import { TableSkeleton } from '../components/TableSkeleton'
import { VisibleErrorReporter } from '../components/VisibleErrorReporter'
import { toast } from '../components/ui/toast'
import { useToolbarSlot } from '../hooks/useToolbarControls'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { monitoringItemPath } from '../lib/monitoringLink'
import {
  monitoringWatchGroupPrompt,
  monitoringWatchPrompt,
  PROVIDER_LABEL,
} from '../lib/monitoringWatch'
import { readSwrCache } from '../lib/swrCache'
import { useRowSelection } from '../lib/useRowSelection'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { buildMonitoringColumns } from './monitoring/columns'
import {
  filterMonitoringRows,
  monitoringRowKey,
  PROVIDER_OPTIONS,
  STATUS_OPTIONS,
} from './monitoring/constants'
import { FilterSelect } from './monitoring/parts'
import { menuItems } from './monitoring/rowActions'
import { useMonitoringOverviewSync } from './monitoring/useMonitoringOverviewSync'
import { MAX_WATCH_GROUP_MEMBERS, planWatchSelection } from './monitoring/watchSelection'
import { WatchDestinationDialog } from './monitoring/WatchDestinationDialog'

import type { MonitoringOverview, MonitoringOverviewRow } from '../types'
import type { ProviderFilter, StatusFilter } from './monitoring/constants'

export { WatchDestinationDialog } from './monitoring/WatchDestinationDialog'
export type { WatchDestinationDialogProps } from './monitoring/WatchDestinationDialog'

// Read-only aggregation across the team's bound observability providers.
// Rows come live from each provider's API via the backend
// fan-out endpoint — Nuphos stores nothing. Creation/editing happens
// through the agent or the provider's own console; the only action here
// is the deep link out.

type Props = {
  teamId: string
  filter?: string
  refreshKey?: number
  onCount?: (count: number) => void
  onLoading?: (loading: boolean) => void
  // Prefill (not send) the agent composer — the "Watch with Agent" shortcut.
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
  /** Navigate to the Connectors page — the empty state's "Go to Connectors". */
  onOpenConnectors?: () => void
}

export function MonitoringView({
  teamId,
  filter,
  refreshKey,
  onCount,
  onLoading,
  onOpenAgentChat,
  onOpenConnectors,
}: Props) {
  // Stale-while-revalidate: a previous snapshot for this team renders
  // instantly on mount (page switches feel instant) while a background
  // refresh runs. Cold start — no snapshot yet — shows skeleton rows.
  const cacheKey = `monitoring-overview:${teamId}`
  const [overview, setOverview] = useState<MonitoringOverview | null>(
    () => readSwrCache<MonitoringOverview>(cacheKey) ?? null,
  )
  const [loading, setLoading] = useState(overview === null)
  const [menu, setMenu] = useState<{ row: MonitoringOverviewRow; x: number; y: number } | null>(
    null,
  )
  const [watchRow, setWatchRow] = useState<MonitoringOverviewRow | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all')
  // Search text is owned by the shared toolbar (the `filter` prop); the two
  // status/provider filters ride the toolbar's left slot.
  // Gate publishing on isActive so a keep-alive'd background tab never leaks its
  // controls into the shared row.
  const { isActive } = useWorkspaceTab()
  const filtersSlot = useToolbarSlot('left', isActive)
  const search = filter ?? ''
  const { linkForRow, copyLink } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (row: MonitoringOverviewRow) => linkForRow({ path: monitoringItemPath(teamId, row) }),
    [linkForRow, teamId],
  )

  const { deleteRow } = useMonitoringOverviewSync({
    teamId,
    cacheKey,
    refreshKey,
    onCount,
    onLoading,
    setOverview,
    setLoading,
  })

  const rows = overview?.rows ?? []
  const filtered = useMemo(
    () => filterMonitoringRows(rows, search, statusFilter, providerFilter),
    [rows, search, statusFilter, providerFilter],
  )

  // Row multi-select → a floating BulkActionBar offers "Watch selected", which
  // hands the group off to the agent as a single Watch Group. The
  // per-row "Watch" stays for the single-item case.
  const {
    selectedKeys,
    setSelectedKeys,
    selectedItems,
    clear: clearSelection,
  } = useRowSelection(filtered, monitoringRowKey, teamId)
  const [watchGroupRows, setWatchGroupRows] = useState<MonitoringOverviewRow[] | null>(null)
  const beginWatchGroup = useCallback(() => {
    const plan = planWatchSelection(selectedItems)

    if (plan.kind === 'none') return
    // One item is not a group: send it through the single-item Watch, which is
    // both what was meant and the only shape trigger_group_create accepts.
    if (plan.kind === 'single') {
      setWatchRow(plan.row)

      return
    }
    if (plan.truncated) {
      toast.info(
        `Watch Group limited to ${String(MAX_WATCH_GROUP_MEMBERS)} items`,
        'Split larger selections into separate groups so provisioning stays reviewable.',
      )
    }
    setWatchGroupRows(plan.rows)
  }, [selectedItems])

  const columns = useMemo(() => buildMonitoringColumns(), [])
  const hasProviderErrors = (overview?.providerErrors.length ?? 0) > 0

  return (
    <div className="flex h-full flex-col">
      {filtersSlot &&
        createPortal(
          <>
            <FilterSelect
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={setStatusFilter}
            />
            <FilterSelect
              value={providerFilter}
              options={PROVIDER_OPTIONS}
              onChange={setProviderFilter}
            />
          </>,
          filtersSlot,
        )}

      {(overview?.providerErrors.length ?? 0) > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zGray-800 px-4 py-2">
          {overview!.providerErrors.map((e) => (
            <span
              key={`${e.provider}:${e.integrationId}`}
              className="inline-flex items-center gap-1.5 rounded bg-error/10 px-2 py-1 text-[11px] text-error"
              title={e.message}
            >
              <VisibleErrorReporter message={e.message} surface="monitoring_provider_error" />
              <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />
              {PROVIDER_LABEL[e.provider]} · {e.integrationLabel}: unreachable
            </span>
          ))}
        </div>
      )}

      {onOpenAgentChat && watchRow && (
        <WatchDestinationDialog
          key={`${watchRow.provider}:${watchRow.integrationId}:${watchRow.providerResourceId}`}
          subjectName={watchRow.name}
          teamId={teamId}
          onClose={() => setWatchRow(null)}
          onContinue={(destination) => {
            if (!watchRow) return
            onOpenAgentChat(monitoringWatchPrompt(watchRow, destination), { send: false })
            setWatchRow(null)
            // Reached from the row menu (nothing selected — a no-op) and from
            // "Watch selected" with one row, where the bar should not linger
            // after the item has been handed to the agent.
            clearSelection()
          }}
        />
      )}

      {onOpenAgentChat && watchGroupRows && (
        <WatchDestinationDialog
          key={`group:${watchGroupRows.map(monitoringRowKey).join('|')}`}
          subjectName={`${String(watchGroupRows.length)} monitoring items`}
          teamId={teamId}
          group={{
            memberCount: watchGroupRows.length,
            defaultName: `${watchGroupRows[0]?.name ?? 'Monitoring'} group`,
          }}
          onClose={() => setWatchGroupRows(null)}
          onContinue={(destination, groupName) => {
            onOpenAgentChat(
              monitoringWatchGroupPrompt(
                groupName || 'Monitoring Watch Group',
                watchGroupRows,
                destination,
              ),
              { send: false },
            )
            setWatchGroupRows(null)
            clearSelection()
          }}
        />
      )}

      {onOpenAgentChat && (
        <BulkActionBar
          count={selectedItems.length}
          onClear={clearSelection}
          actions={[
            {
              key: 'watch',
              label: 'Watch selected',
              icon: faEye,
              onClick: beginWatchGroup,
            },
          ]}
        />
      )}

      {/* Table's root is `flex-1` and expects a flex-column parent — without
          `flex flex-col` here it collapses to content height and an empty
          result renders as a floating header strip. */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(
            menu.row,
            deleteRow,
            () => copyLink(getRowLink(menu.row)),
            onOpenAgentChat ? setWatchRow : undefined,
          )}
          onClose={() => setMenu(null)}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {overview === null && loading ? (
          <TableSkeleton />
        ) : rows.length === 0 && !loading ? (
          <EmptyState
            icon={HeartPulse}
            title="Monitoring"
            description={
              hasProviderErrors
                ? 'Every connected provider failed to respond. Check the error chips above, or retry.'
                : 'Monitoring aggregates uptime and health checks from the observability providers your team has connected — Better Stack, Grafana, and more. Connect a provider to see checks here.'
            }
            primaryAction={
              !hasProviderErrors && onOpenConnectors
                ? { label: 'Go to Connectors', icon: Cloud, onClick: onOpenConnectors }
                : undefined
            }
          />
        ) : (
          <Table
            columns={columns}
            rows={filtered}
            rowKey={monitoringRowKey}
            selectable={Boolean(onOpenAgentChat)}
            selectedKeys={selectedKeys}
            onSelectedKeysChange={setSelectedKeys}
            loading={loading && rows.length === 0}
            storageKey="monitoring-overview"
            onRowContextMenu={(row, e) => setMenu({ row, x: e.clientX, y: e.clientY })}
            empty={
              <div className="py-12 text-center text-[11px] text-tertiary">
                No checks match the current filters.
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}
