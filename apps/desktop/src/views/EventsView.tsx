import clsx from 'clsx'
import { useEffect } from 'react'

import { Age } from '../components/Age'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { AGE_DESC_SORT } from '../lib/tableSort'

import type { EventItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

// Cluster-wide event log streamed by the k8s informer. Rows are keyed by the
// involved object identity plus the Event uid/name, matching the main-process
// watch cache.
export function EventsView({ namespace, filter, refreshKey, onCount, onLoading }: Props) {
  const context = useRequiredKubeContext()
  const { rows, loading, error, changedCells } = useWatchedList<EventItem>({
    context,
    kind: 'Event',
    namespace: namespace || null,
    rowKey: (e) => e.uid ?? `${e.namespace}/${e.kind}/${e.name}/${e.reason}/${e.timestamp ?? ''}`,
    scopeKey: `events:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const filtered = rows.filter((e) => {
    if (!filter) return true
    const f = filter.toLowerCase()

    return (
      e.name.toLowerCase().includes(f) ||
      e.kind.toLowerCase().includes(f) ||
      e.namespace.toLowerCase().includes(f) ||
      e.reason.toLowerCase().includes(f) ||
      e.message.toLowerCase().includes(f) ||
      e.type_.toLowerCase().includes(f)
    )
  })

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-error text-[13px]">{error}</div>
      </div>
    )
  }

  return (
    <Table<EventItem>
      loading={loading}
      rows={filtered}
      rowKey={(e) => e.uid ?? `${e.namespace}/${e.kind}/${e.name}/${e.reason}/${e.timestamp ?? ''}`}
      storageKey="events"
      defaultSort={AGE_DESC_SORT}
      changedCells={changedCells}
      columns={[
        {
          key: 'type',
          header: 'Type',
          width: 90,
          sortAccessor: (e) => e.type_,
          render: (e) => (
            <span
              className={clsx(
                'px-1.5 py-0.5 rounded text-[11px]',
                e.type_ === 'Warning' ? 'bg-error/15 text-error' : 'bg-zGray-800 text-secondary',
              )}
            >
              {e.type_ || 'Normal'}
            </span>
          ),
        },
        {
          key: 'reason',
          header: 'Reason',
          width: 160,
          sortAccessor: (e) => e.reason,
          render: (e) => <span className="text-main font-medium">{e.reason}</span>,
        },
        {
          key: 'object',
          header: 'Object',
          width: 280,
          sortAccessor: (e) => `${e.kind}/${e.name}`,
          render: (e) => (
            <span className="text-secondary">
              <span className="text-tertiary">{e.kind}</span>
              <span className="opacity-60 mx-1">·</span>
              <span className="text-zViolet-accent">{e.name}</span>
            </span>
          ),
        },
        {
          key: 'namespace',
          header: 'Namespace',
          width: 160,
          sortAccessor: (e) => e.namespace,
          render: (e) => <span className="text-secondary">{e.namespace || '-'}</span>,
        },
        {
          key: 'message',
          header: 'Message',
          width: 480,
          sortAccessor: (e) => e.message,
          render: (e) => <span className="text-secondary text-[12.5px]">{e.message}</span>,
        },
        {
          key: 'count',
          header: 'Count',
          width: 70,
          sortAccessor: (e) => e.count,
          render: (e) => (
            <span className={e.count > 1 ? 'text-warning' : 'text-tertiary'}>
              {e.count > 0 ? e.count : '-'}
            </span>
          ),
        },
        {
          key: 'age',
          header: 'Age',
          width: 100,
          sortAccessor: (e) => e.timestamp ?? '',
          render: (e) => (
            <span className="text-tertiary">
              <Age value={e.timestamp} />
            </span>
          ),
        },
      ]}
    />
  )
}
