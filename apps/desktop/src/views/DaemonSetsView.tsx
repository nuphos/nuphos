import { ReplicaCount } from '../components/K8sHealth'
import { faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import { Age } from '../components/Age'
import { BulkActionBar } from '../components/BulkActionBar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Table } from '../components/Table'
import { UsageBar } from '../components/UsageBar'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { runBulk } from '../lib/bulkActions'
import { makeFilterMatcher } from '../lib/filterQuery'
import { useK8sResourceRowMenu } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useRowSelection } from '../lib/useRowSelection'
import { daemonSetPhase } from '../lib/workloadStatus'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'
import { formatCpu, formatMemory } from '../utils'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { DaemonSetItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (d: DaemonSetItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function DaemonSetsView({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
}: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<DaemonSetItem>({
    context,
    kind: 'DaemonSet',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `daemonsets:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const matcher = useMemo(
    () =>
      makeFilterMatcher<DaemonSetItem>(filter, (r) => ({
        text: [r.name, r.namespace],
        fields: { status: daemonSetPhase(r), ns: r.namespace, namespace: r.namespace },
      })),
    [filter],
  )
  const filtered = rows.filter(matcher)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: DaemonSetItem) =>
      linkForRow({
        target: { kind: 'DaemonSet', namespace: r.namespace, name: r.name },
      }),
    [linkForRow],
  )
  const getDeleteTarget = useCallback(
    (r: DaemonSetItem) => ({ kind: 'DaemonSet', namespace: r.namespace, name: r.name }),
    [],
  )
  const getExtraActions = useCallback(
    (r: DaemonSetItem, ctx: string): ContextMenuItem[] => [
      {
        key: 'restart',
        label: 'Restart rollout',
        icon: faRotateLeft,
        disabled: r.update_strategy === 'OnDelete',
        hint:
          r.update_strategy === 'OnDelete'
            ? 'OnDelete requires replacing pods manually'
            : undefined,
        confirm: `Restart DaemonSet "${r.namespace}/${r.name}"? Its RollingUpdate controller will replace the pods.`,
        onSelect: async () => {
          await api.restartWorkload(ctx, 'DaemonSet', r.namespace, r.name)
        },
      },
    ],
    [],
  )
  const { onRowContextMenu, menu } = useK8sResourceRowMenu(
    getRowLink,
    getDeleteTarget,
    getExtraActions,
  )

  const {
    selectedKeys,
    setSelectedKeys,
    selectedItems,
    clear: clearSelection,
  } = useRowSelection(filtered, (r) => `${r.namespace}/${r.name}`, `${context}:${namespace}`)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const restartBlocked = selectedItems.some((item) => item.update_strategy === 'OnDelete')

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-error text-[13px]">{error}</div>
      </div>
    )
  }

  return (
    <>
      {menu}
      <ConfirmDialog
        open={confirmRestart}
        title="Restart rollout"
        description={`Restart ${String(selectedItems.length)} DaemonSet${selectedItems.length === 1 ? '' : 's'}? Their RollingUpdate controllers will replace the pods.`}
        confirmLabel="Restart"
        onConfirm={async () => {
          const targets = selectedItems

          setConfirmRestart(false)
          await runBulk(
            targets,
            (r) => api.restartWorkload(context, 'DaemonSet', r.namespace, r.name),
            { verbing: 'restart', verbed: 'Restarted', noun: 'DaemonSet' },
          )
          clearSelection()
        }}
        onClose={() => setConfirmRestart(false)}
      />
      <BulkActionBar
        count={selectedItems.length}
        onClear={clearSelection}
        actions={[
          {
            key: 'restart',
            label: 'Restart rollout',
            icon: faRotateLeft,
            disabled: restartBlocked,
            onClick: () => setConfirmRestart(true),
          },
        ]}
      />
      <Table<DaemonSetItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        selectable
        selectedKeys={selectedKeys}
        onSelectedKeysChange={setSelectedKeys}
        storageKey="daemonsets"
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        columns={[
          {
            key: 'namespace',
            header: 'Namespace',
            width: 160,
            sortAccessor: (r) => r.namespace,
            render: (r) => <span className="text-secondary">{r.namespace}</span>,
          },
          {
            key: 'name',
            header: 'Name',
            width: 280,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'desired',
            header: 'Desired',
            width: 90,
            sortAccessor: (r) => r.desired,
            render: (r) => r.desired,
          },
          {
            key: 'current',
            header: 'Current',
            width: 90,
            sortAccessor: (r) => r.current,
            render: (r) => <ReplicaCount value={r.current} desired={r.desired} />,
          },
          {
            key: 'ready',
            header: 'Ready',
            width: 90,
            sortAccessor: (r) => r.ready,
            render: (r) => <ReplicaCount value={r.ready} desired={r.desired} />,
          },
          {
            key: 'available',
            header: 'Available',
            width: 100,
            sortAccessor: (r) => r.available,
            render: (r) => <ReplicaCount value={r.available} desired={r.desired} />,
          },
          {
            key: 'up_to_date',
            header: 'Up-to-date',
            width: 110,
            sortAccessor: (r) => r.up_to_date,
            render: (r) => <ReplicaCount value={r.up_to_date} desired={r.desired} />,
          },
          {
            key: 'cpu',
            header: 'CPU',
            width: 170,
            sortAccessor: (r) => r.cpu,
            render: (r) => (
              <UsageBar
                used={r.cpu}
                requested={r.cpu_request}
                capacity={r.cpu_limit}
                format={formatCpu}
              />
            ),
          },
          {
            key: 'memory',
            header: 'Memory',
            width: 180,
            sortAccessor: (r) => r.memory,
            render: (r) => (
              <UsageBar
                resource="memory"
                used={r.memory}
                requested={r.memory_request}
                capacity={r.memory_limit}
                format={formatMemory}
              />
            ),
          },
          {
            key: 'age',
            header: 'Age',
            width: 100,
            sortAccessor: (r) => r.age ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.age} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
