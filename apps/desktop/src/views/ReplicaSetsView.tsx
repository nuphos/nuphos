import { ReplicaCount } from '../components/K8sHealth'
import { useCallback, useEffect, useMemo } from 'react'

import { Age } from '../components/Age'
import { Table } from '../components/Table'
import { UsageBar } from '../components/UsageBar'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { makeFilterMatcher } from '../lib/filterQuery'
import { useK8sResourceRowMenu } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { replicaSetPhase } from '../lib/workloadStatus'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'
import { formatCpu, formatMemory } from '../utils'

import type { ReplicaSetItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (r: ReplicaSetItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function ReplicaSetsView({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
}: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<ReplicaSetItem>({
    context,
    kind: 'ReplicaSet',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `replicasets:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const matcher = useMemo(
    () =>
      makeFilterMatcher<ReplicaSetItem>(filter, (r) => ({
        text: [r.name, r.namespace],
        fields: { status: replicaSetPhase(r), ns: r.namespace, namespace: r.namespace },
      })),
    [filter],
  )
  const filtered = rows.filter(matcher)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: ReplicaSetItem) =>
      linkForRow({
        target: { kind: 'ReplicaSet', namespace: r.namespace, name: r.name },
      }),
    [linkForRow],
  )
  const getDeleteTarget = useCallback(
    (r: ReplicaSetItem) => ({ kind: 'ReplicaSet', namespace: r.namespace, name: r.name }),
    [],
  )
  const { onRowContextMenu, menu } = useK8sResourceRowMenu(getRowLink, getDeleteTarget)

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
      <Table<ReplicaSetItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        storageKey="replicasets"
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
