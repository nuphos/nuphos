import { File as FileIcon, Folder } from 'lucide-react'

import { Age } from '../../components/Age'
import { Table } from '../../components/Table'

import { formatBytes } from './shared'

import type { BucketRow } from './s3-bucket-rows'

export function S3ObjectsTable({
  loading,
  rows,
  bucketName,
  empty,
  onRowClick,
  onRowContextMenu,
}: {
  loading: boolean
  rows: BucketRow[]
  bucketName: string
  empty: string
  onRowClick: (row: BucketRow) => void
  onRowContextMenu: (row: BucketRow, e: { clientX: number; clientY: number }) => void
}) {
  return (
    <Table<BucketRow>
      loading={loading}
      rows={rows}
      rowKey={(r) => r.key}
      onPrimaryAction={onRowClick}
      onRowContextMenu={onRowContextMenu}
      storageKey={`aws.s3-objects.${bucketName}`}
      defaultSort={{ key: 'name', dir: 'asc' }}
      empty={empty}
      columns={[
        {
          key: 'name',
          header: 'Name',
          width: 480,
          sortAccessor: (r) => (r.kind === 'prefix' ? '0:' : '1:') + r.name,
          render: (r) => (
            <span className="inline-flex items-center gap-2 truncate">
              {r.kind === 'prefix' ? (
                <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" strokeWidth={1.8} />
              ) : (
                <FileIcon className="w-3.5 h-3.5 text-tertiary shrink-0" strokeWidth={1.8} />
              )}
              <span
                className={
                  r.kind === 'prefix' ? 'text-zViolet-accent truncate' : 'text-main truncate'
                }
                title={r.name}
              >
                {r.name}
              </span>
            </span>
          ),
        },
        {
          key: 'size',
          header: 'Size',
          width: 100,
          sortAccessor: (r) => (r.kind === 'object' ? r.object.size : -1),
          render: (r) =>
            r.kind === 'object' ? (
              <span className="text-secondary tabular-nums">{formatBytes(r.object.size)}</span>
            ) : (
              <span className="text-tertiary">—</span>
            ),
        },
        {
          key: 'modified',
          header: 'Last modified',
          width: 140,
          sortAccessor: (r) => (r.kind === 'object' ? (r.object.lastModified ?? '') : ''),
          render: (r) =>
            r.kind === 'object' ? (
              <span className="text-tertiary">
                <Age value={r.object.lastModified} />
              </span>
            ) : (
              <span className="text-tertiary">—</span>
            ),
        },
        {
          key: 'storage',
          header: 'Storage',
          width: 120,
          sortAccessor: (r) => (r.kind === 'object' ? (r.object.storageClass ?? '') : ''),
          render: (r) =>
            r.kind === 'object' ? (
              <span className="text-[11px] text-secondary px-1.5 py-0.5 rounded bg-zGray-800/60">
                {r.object.storageClass ?? 'STANDARD'}
              </span>
            ) : (
              <span className="text-tertiary">—</span>
            ),
        },
      ]}
    />
  )
}
