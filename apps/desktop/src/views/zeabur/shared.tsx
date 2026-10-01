import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useReportVisibleError } from '../../components/VisibleErrorReporter'

export type CommonProps = {
  teamId: string
  zeaburId: string
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function ErrorBlock({ message }: { message: string }) {
  useReportVisibleError(message, 'zeabur_error_block')

  return <div className="p-8 text-error text-[13px]">{message}</div>
}

export function ResourceTable<
  T extends {
    id: string
    name: string
    status: string | null
    region: string | null
    createdAt: string | null
  },
>({
  loading,
  rows,
  storageKey,
  onSelect,
}: {
  loading: boolean
  rows: T[]
  storageKey: string
  onSelect: (row: T) => void
}) {
  return (
    <Table
      loading={loading}
      columns={[
        {
          key: 'name',
          header: 'Name',
          render: (item) => <span className="font-mono text-[12px]">{item.name}</span>,
          sortAccessor: (item) => item.name,
        },
        {
          key: 'region',
          header: 'Region',
          render: (item) => <span className="text-secondary">{item.region ?? '-'}</span>,
          sortAccessor: (item) => item.region ?? '',
        },
        {
          key: 'status',
          header: 'Status',
          render: (item) =>
            item.status ? (
              <StatusBadge status={item.status} />
            ) : (
              <span className="text-tertiary">-</span>
            ),
          sortAccessor: (item) => item.status ?? '',
        },
        {
          key: 'age',
          header: 'Age',
          render: (item) =>
            item.createdAt ? (
              <Age value={item.createdAt} />
            ) : (
              <span className="text-tertiary">-</span>
            ),
          sortAccessor: (item) => item.createdAt ?? '',
        },
        {
          key: 'id',
          header: 'ID',
          render: (item) => (
            <span className="font-mono text-[11.5px] text-secondary truncate">{item.id}</span>
          ),
          sortAccessor: (item) => item.id,
        },
      ]}
      rows={rows}
      rowKey={(item) => item.id}
      storageKey={storageKey}
      defaultSort={{ key: 'name', dir: 'asc' }}
      onPrimaryAction={onSelect}
    />
  )
}
