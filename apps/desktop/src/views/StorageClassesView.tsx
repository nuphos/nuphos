import { useCallback, useEffect } from 'react'

import { Age } from '../components/Age'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { useK8sResourceRowMenu } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'

import type { StorageClassItem } from '../types'

type Props = {
  filter: string
  refreshKey: number
  onSelect: (s: StorageClassItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function StorageClassesView({ filter, refreshKey, onSelect, onCount, onLoading }: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<StorageClassItem>({
    context,
    kind: 'StorageClass',
    namespace: null,
    rowKey: (r) => `/${r.name}`,
    scopeKey: 'storageclasses',
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const filtered = rows.filter((r) => {
    if (!filter) return true
    const f = filter.toLowerCase()

    return r.name.toLowerCase().includes(f) || r.provisioner.toLowerCase().includes(f)
  })

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: StorageClassItem) =>
      linkForRow({
        target: { kind: 'StorageClass', namespace: null, name: r.name },
      }),
    [linkForRow],
  )
  const getDeleteTarget = useCallback(
    (r: StorageClassItem) => ({ kind: 'StorageClass', namespace: null, name: r.name }),
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
      <Table<StorageClassItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.name}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        storageKey="storageclasses"
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 280,
            sortAccessor: (r) => r.name,
            render: (r) => (
              <span className="text-zViolet-accent">
                {r.name}
                {r.is_default && (
                  <span className="ml-1.5 text-[10.5px] text-warning">(default)</span>
                )}
              </span>
            ),
          },
          {
            key: 'provisioner',
            header: 'Provisioner',
            width: 280,
            sortAccessor: (r) => r.provisioner,
            render: (r) => (
              <span className="text-secondary font-mono text-[12px]">{r.provisioner}</span>
            ),
          },
          {
            key: 'reclaim_policy',
            header: 'Reclaim Policy',
            width: 140,
            sortAccessor: (r) => r.reclaim_policy,
            render: (r) => <span className="text-secondary">{r.reclaim_policy}</span>,
          },
          {
            key: 'volume_binding_mode',
            header: 'Volume Binding',
            width: 180,
            sortAccessor: (r) => r.volume_binding_mode,
            render: (r) => <span className="text-secondary">{r.volume_binding_mode}</span>,
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
