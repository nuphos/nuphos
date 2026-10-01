import { useCallback, useEffect } from 'react'

import { Age } from '../components/Age'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { useK8sResourceRowMenu } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'

import type { EndpointSliceItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (e: EndpointSliceItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function EndpointSlicesView({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
}: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<EndpointSliceItem>({
    context,
    kind: 'EndpointSlice',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `endpointslices:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const filtered = rows.filter((r) => {
    if (!filter) return true
    const f = filter.toLowerCase()

    return r.name.toLowerCase().includes(f) || r.namespace.toLowerCase().includes(f)
  })

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: EndpointSliceItem) =>
      linkForRow({
        target: {
          kind: 'EndpointSlice',
          namespace: r.namespace,
          name: r.name,
        },
      }),
    [linkForRow],
  )
  const getDeleteTarget = useCallback(
    (r: EndpointSliceItem) => ({ kind: 'EndpointSlice', namespace: r.namespace, name: r.name }),
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
      <Table<EndpointSliceItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        storageKey="endpointslices"
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
            key: 'address_type',
            header: 'Address Type',
            width: 130,
            sortAccessor: (r) => r.address_type,
            render: (r) => <span className="text-secondary">{r.address_type}</span>,
          },
          {
            key: 'ports',
            header: 'Ports',
            width: 180,
            sortAccessor: (r) => r.ports.join(','),
            render: (r) => (
              <span className="text-secondary font-mono text-[12px]">
                {r.ports.join(', ') || '-'}
              </span>
            ),
          },
          {
            key: 'endpoints',
            header: 'Endpoints',
            width: 100,
            sortAccessor: (r) => r.endpoints,
            render: (r) => r.endpoints,
          },
          {
            key: 'ready',
            header: 'Ready',
            width: 90,
            sortAccessor: (r) => r.ready,
            render: (r) => <span className="text-success">{r.ready}</span>,
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
