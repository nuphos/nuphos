import { useCallback, useEffect, useMemo } from 'react'

import { Age } from '../../components/Age'
import { BulkActionBar } from '../../components/BulkActionBar'
import { Table } from '../../components/Table'
import { useReportLoading } from '../../components/useReportLoading'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { usePolledList } from '../../hooks/usePolledList'
import { matchesFilter, parseFilterQuery } from '../../lib/filterQuery'
import { useK8sResourceRowMenu } from '../../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../../lib/tableSort'
import { useRowSelection } from '../../lib/useRowSelection'

import { includes } from './shared'
import { ErrorState } from './ui'

import type { BaseProps, DeleteTarget, NamespacedProps, RowActionFactory } from './shared'
import type { BulkAction } from '../../components/BulkActionBar'
import type { Column } from '../../components/Table'
import type { FilterRecord } from '../../lib/filterQuery'

export function NamespacedTable<T extends { namespace: string; name: string; age: string | null }>({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
  loader,
  storageKey,
  columns,
  rowKey,
  matches,
  filterRecord,
  deleteTarget,
  rowActions,
  bulkActions,
}: NamespacedProps<T> & {
  loader: (context: string, namespace: string) => Promise<T[]>
  storageKey: string
  columns: Column<T>[]
  rowKey?: (row: T) => string
  matches?: (row: T, filter: string) => boolean
  // Opt-in structured (`key=value`) filtering. Takes precedence over `matches`.
  filterRecord?: (row: T) => FilterRecord
  deleteTarget?: (row: T) => DeleteTarget | null
  rowActions?: RowActionFactory<T>
  // Opt-in row multi-select: when provided, renders the checkbox column + a
  // bulk-action bar built from the current selection.
  bulkActions?: (selected: T[], clear: () => void, context: string) => BulkAction[]
}) {
  const context = useRequiredKubeContext()
  const theRowKey = rowKey ?? ((r: T) => `${r.namespace}/${r.name}`)
  const { rows, loading, error, changedCells } = usePolledList<T>({
    loader: () => loader(context, namespace),
    rowKey: theRowKey,
    refreshKey,
    scopeKey: `${storageKey}:${context}:${namespace}`,
  })

  useReportLoading(loading, onLoading)
  const f = filter.toLowerCase()
  const parsed = useMemo(() => parseFilterQuery(filter), [filter])
  const filtered = rows.filter((row) =>
    filterRecord
      ? matchesFilter(parsed, filterRecord(row))
      : matches
        ? matches(row, f)
        : includes(row.name, f) || includes(row.namespace, f),
  )

  useEffect(() => onCount(filtered.length), [filtered.length, onCount])
  const noDeleteTarget = useCallback(() => null, [])
  const { onRowContextMenu, menu } = useK8sResourceRowMenu(
    null,
    deleteTarget ?? noDeleteTarget,
    rowActions,
  )
  const hasRowMenu = !!deleteTarget || !!rowActions

  const selectable = !!bulkActions
  const { selectedKeys, setSelectedKeys, selectedItems, clear } = useRowSelection(
    filtered,
    theRowKey,
    `${context}:${namespace}`,
  )

  if (error) return <ErrorState message={error} />

  return (
    <>
      {menu}
      {selectable && (
        <BulkActionBar
          count={selectedItems.length}
          onClear={clear}
          actions={bulkActions(selectedItems, clear, context)}
        />
      )}
      <Table<T>
        loading={loading}
        rows={filtered}
        rowKey={theRowKey}
        onPrimaryAction={onSelect}
        onRowContextMenu={hasRowMenu ? onRowContextMenu : undefined}
        selectable={selectable}
        selectedKeys={selectable ? selectedKeys : undefined}
        onSelectedKeysChange={selectable ? setSelectedKeys : undefined}
        storageKey={storageKey}
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
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
          ...columns,
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

export function ClusterTable<T extends { name: string; age: string | null }>({
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
  loader,
  storageKey,
  columns,
  matches,
  filterRecord,
  deleteTarget,
}: BaseProps<T> & {
  loader: (context: string) => Promise<T[]>
  storageKey: string
  columns: Column<T>[]
  matches?: (row: T, filter: string) => boolean
  // Opt-in structured (`key=value`) filtering. Takes precedence over `matches`.
  filterRecord?: (row: T) => FilterRecord
  deleteTarget?: (row: T) => DeleteTarget | null
}) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = usePolledList<T>({
    loader: () => loader(context),
    rowKey: (r) => r.name,
    refreshKey,
    scopeKey: `${storageKey}:${context}`,
  })

  useReportLoading(loading, onLoading)
  const f = filter.toLowerCase()
  const parsed = useMemo(() => parseFilterQuery(filter), [filter])
  const filtered = rows.filter((row) =>
    filterRecord
      ? matchesFilter(parsed, filterRecord(row))
      : matches
        ? matches(row, f)
        : includes(row.name, f),
  )

  useEffect(() => onCount(filtered.length), [filtered.length, onCount])
  const noDeleteTarget = useCallback(() => null, [])
  const { onRowContextMenu, menu } = useK8sResourceRowMenu(null, deleteTarget ?? noDeleteTarget)

  if (error) return <ErrorState message={error} />

  return (
    <>
      {menu}
      <Table<T>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.name}
        onPrimaryAction={onSelect}
        onRowContextMenu={deleteTarget ? onRowContextMenu : undefined}
        storageKey={storageKey}
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 300,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          ...columns,
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
