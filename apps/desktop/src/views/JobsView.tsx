import { useCallback, useEffect, useMemo } from 'react'

import { Age } from '../components/Age'
import { K8sStatus as StatusBadge } from '../components/K8sHealth'
import { Table } from '../components/Table'
import { UsageBar } from '../components/UsageBar'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { makeFilterMatcher } from '../lib/filterQuery'
import { useK8sResourceRowMenu } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { jobPhase } from '../lib/workloadStatus'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'
import { formatCpu, formatMemory } from '../utils'

import type { JobItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (j: JobItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function JobsView({ namespace, filter, refreshKey, onSelect, onCount, onLoading }: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<JobItem>({
    context,
    kind: 'Job',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `jobs:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const matcher = useMemo(
    () =>
      makeFilterMatcher<JobItem>(filter, (r) => ({
        text: [r.name, r.namespace, r.status],
        fields: { status: [jobPhase(r), r.status], ns: r.namespace, namespace: r.namespace },
      })),
    [filter],
  )
  const filtered = rows.filter(matcher)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: JobItem) =>
      linkForRow({
        target: { kind: 'Job', namespace: r.namespace, name: r.name },
      }),
    [linkForRow],
  )
  const getDeleteTarget = useCallback(
    (r: JobItem) => ({ kind: 'Job', namespace: r.namespace, name: r.name }),
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
      <Table<JobItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        storageKey="jobs"
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
            key: 'completions',
            header: 'Completions',
            width: 120,
            sortAccessor: (r) => r.completions,
            render: (r) => <span className="text-secondary">{r.completions}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            width: 130,
            sortAccessor: (r) => r.status,
            render: (r) => <StatusBadge status={r.status} />,
          },
          {
            key: 'duration',
            header: 'Duration',
            width: 110,
            sortAccessor: (r) => r.duration ?? '',
            render: (r) => <span className="text-tertiary">{r.duration ?? '-'}</span>,
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
