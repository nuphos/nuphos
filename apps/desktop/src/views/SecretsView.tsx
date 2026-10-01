import { FileKey2, KeyRound, Rows3, Shield } from 'lucide-react'
import { useCallback, useEffect } from 'react'

import { Age } from '../components/Age'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { useK8sResourceRowMenu } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useWorkspaceRowLink } from '../lib/workspaceRowLink'

import type { SecretItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (s: SecretItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function SecretsView({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
}: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<SecretItem>({
    context,
    kind: 'Secret',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `secrets:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const filtered = rows.filter((r) => {
    if (!filter) return true
    const f = filter.toLowerCase()

    return (
      r.name.toLowerCase().includes(f) ||
      r.namespace.toLowerCase().includes(f) ||
      r.type.toLowerCase().includes(f) ||
      (r.keyNames ?? []).some((key) => key.toLowerCase().includes(f))
    )
  })
  const namespaceCount = new Set(filtered.map((r) => r.namespace)).size
  const totalKeys = filtered.reduce((sum, r) => sum + r.keys, 0)
  const typeCount = new Set(filtered.map((r) => r.type)).size

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: SecretItem) =>
      linkForRow({
        target: { kind: 'Secret', namespace: r.namespace, name: r.name },
      }),
    [linkForRow],
  )
  const getDeleteTarget = useCallback(
    (r: SecretItem) => ({ kind: 'Secret', namespace: r.namespace, name: r.name }),
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
          { label: 'Secrets', value: filtered.length, icon: Shield },
          { label: 'Keys', value: totalKeys, icon: FileKey2 },
          { label: 'Types', value: typeCount, icon: KeyRound },
          { label: 'Namespaces', value: namespaceCount, icon: Rows3 },
        ]}
      />
      <Table<SecretItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        storageKey="secrets"
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        empty={filter ? `No Secrets match "${filter}"` : 'No Secrets found'}
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
            width: 260,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'type',
            header: 'Type',
            width: 230,
            sortAccessor: (r) => r.type,
            render: (r) => <SecretType type={r.type} />,
          },
          {
            key: 'keyNames',
            header: 'Key names',
            width: 320,
            sortAccessor: (r) => r.keys,
            render: (r) => <KeyChips keys={r.keyNames ?? []} count={r.keys} />,
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
  icon: typeof Shield
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

function SecretType({ type }: { type: string }) {
  const label = type.startsWith('kubernetes.io/') ? type.replace('kubernetes.io/', '') : type

  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zViolet-accent" />
      <span className="truncate font-mono text-[12px] text-secondary" title={type}>
        {label}
      </span>
    </span>
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
