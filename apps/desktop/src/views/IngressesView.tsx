import { useCallback, useEffect } from 'react'

import { Age } from '../components/Age'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { useK8sResourceRowMenu } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'

import type { IngressItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (i: IngressItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function IngressesView({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
}: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<IngressItem>({
    context,
    kind: 'Ingress',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `ingresses:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const filtered = rows.filter((r) => {
    if (!filter) return true
    const f = filter.toLowerCase()

    return (
      r.name.toLowerCase().includes(f) ||
      r.namespace.toLowerCase().includes(f) ||
      r.hosts.some((h) => h.toLowerCase().includes(f))
    )
  })

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: IngressItem) =>
      linkForRow({
        target: { kind: 'Ingress', namespace: r.namespace, name: r.name },
      }),
    [linkForRow],
  )
  const getDeleteTarget = useCallback(
    (r: IngressItem) => ({ kind: 'Ingress', namespace: r.namespace, name: r.name }),
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
      <Table<IngressItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        storageKey="ingresses"
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
            width: 240,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'class',
            header: 'Class',
            width: 130,
            sortAccessor: (r) => r.class,
            render: (r) => <span className="text-secondary">{r.class || '-'}</span>,
          },
          {
            key: 'hosts',
            header: 'Hosts',
            width: 280,
            sortAccessor: (r) => r.hosts.join(','),
            render: (r) => (
              <span className="text-secondary font-mono text-[12px]">
                {r.hosts.join(', ') || '-'}
              </span>
            ),
          },
          {
            key: 'addresses',
            header: 'Address',
            width: 200,
            sortAccessor: (r) => r.addresses.join(','),
            render: (r) => (
              <span className="text-secondary font-mono text-[12px]">
                {r.addresses.join(', ') || '-'}
              </span>
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
