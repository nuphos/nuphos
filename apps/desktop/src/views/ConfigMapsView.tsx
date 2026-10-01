import { Braces, FileKey2, Lock, Rows3 } from 'lucide-react'
import { useCallback, useEffect } from 'react'

import { Age } from '../components/Age'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { useK8sResourceRowMenu } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'

import type { ConfigMapItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (c: ConfigMapItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function ConfigMapsView({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
}: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<ConfigMapItem>({
    context,
    kind: 'ConfigMap',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `configmaps:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const filtered = rows.filter((r) => {
    if (!filter) return true
    const f = filter.toLowerCase()

    return (
      r.name.toLowerCase().includes(f) ||
      r.namespace.toLowerCase().includes(f) ||
      (r.keyNames ?? []).some((key) => key.toLowerCase().includes(f)) ||
      (r.immutable ? 'immutable' : 'mutable').includes(f)
    )
  })
  const namespaceCount = new Set(filtered.map((r) => r.namespace)).size
  const totalKeys = filtered.reduce((sum, r) => sum + r.keys, 0)
  const immutableCount = filtered.filter((r) => r.immutable).length

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: ConfigMapItem) =>
      linkForRow({
        target: { kind: 'ConfigMap', namespace: r.namespace, name: r.name },
      }),
    [linkForRow],
  )
  const getDeleteTarget = useCallback(
    (r: ConfigMapItem) => ({ kind: 'ConfigMap', namespace: r.namespace, name: r.name }),
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
    <div className="h-full min-h-0 flex flex-col">
      {menu}
      <ResourceSummary
        items={[
          { label: 'ConfigMaps', value: filtered.length, icon: Rows3 },
          { label: 'Keys', value: totalKeys, icon: FileKey2 },
          { label: 'Namespaces', value: namespaceCount, icon: Braces },
          { label: 'Immutable', value: immutableCount, icon: Lock },
        ]}
      />
      <Table<ConfigMapItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        storageKey="configmaps"
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        empty={filter ? `No ConfigMaps match "${filter}"` : 'No ConfigMaps found'}
        columns={[
          {
            key: 'namespace',
            header: 'Namespace',
            width: 150,
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
            key: 'keyNames',
            header: 'Key names',
            width: 360,
            sortAccessor: (r) => r.keys,
            render: (r) => <KeyChips keys={r.keyNames ?? []} count={r.keys} />,
          },
          {
            key: 'immutable',
            header: 'Mode',
            width: 110,
            sortAccessor: (r) => r.immutable,
            render: (r) =>
              r.immutable ? (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-amber-300">
                  <Lock className="w-3 h-3" strokeWidth={2} />
                  Immutable
                </span>
              ) : (
                <span className="text-tertiary">Mutable</span>
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
    </div>
  )
}

type SummaryItem = {
  label: string
  value: number
  icon: typeof Rows3
}

function ResourceSummary({ items }: { items: SummaryItem[] }) {
  return (
    <div className="grid grid-cols-4 border-b border-zGray-800/70 bg-zGray-950">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="min-w-0 border-r border-zGray-850 px-4 py-3 last:border-r-0">
          <div className="flex items-center gap-2 text-[11.5px] uppercase tracking-wider text-tertiary">
            <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
            <span className="truncate">{label}</span>
          </div>
          <div className="mt-1 text-[18px] font-semibold text-main tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  )
}

function KeyChips({ keys, count }: { keys: string[]; count: number }) {
  if (count === 0) return <span className="text-tertiary">No keys</span>
  const visible = keys.slice(0, 3)

  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {visible.map((key) => (
        <span
          key={key}
          className="min-w-0 truncate rounded bg-zGray-850 px-1.5 py-0.5 font-mono text-[11.5px] text-secondary"
          title={key}
        >
          {key}
        </span>
      ))}
      {count > visible.length && (
        <span className="flex-shrink-0 text-[11.5px] text-tertiary">+{count - visible.length}</span>
      )}
    </div>
  )
}
