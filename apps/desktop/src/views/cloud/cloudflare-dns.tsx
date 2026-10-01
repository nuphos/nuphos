import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { LeafDetailPanel } from '../../components/LeafDetailPanel'
import { Table } from '../../components/Table'
import { useToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { DnsRecordDialog } from './cloudflare-dns-dialog'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { CloudflareDnsRecord, CloudflareDnsRecordInput } from '../../types'

function formatTtl(ttl: number): string {
  return ttl === 1 ? 'Auto' : `${String(ttl)}s`
}

export function CloudflareDnsRecordsView({
  zoneName,
  recordLoader,
  onCreate,
  onUpdate,
  onDelete,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  zoneName: string
  recordLoader: ResourceListLoader<CloudflareDnsRecord>
  onCreate: (input: CloudflareDnsRecordInput) => Promise<CloudflareDnsRecord>
  onUpdate: (recordId: string, input: CloudflareDnsRecordInput) => Promise<CloudflareDnsRecord>
  onDelete: (recordId: string) => Promise<void>
  getRowLink?: (record: CloudflareDnsRecord) => string
}) {
  const [dialog, setDialog] = useState<
    { mode: 'create'; record: null } | { mode: 'edit'; record: CloudflareDnsRecord } | null
  >(null)
  const [pendingDelete, setPendingDelete] = useState<CloudflareDnsRecord | null>(null)
  // Local flag for the post-mutation refetch (create/update/delete), so the
  // table shows a spinner while we reload even though `useResourceList`'s
  // `loading` stays false (we already have rows on screen).
  const [reloading, setReloading] = useState(false)
  const { pollTick, isActive } = useWorkspaceTab()
  const { items, setItems, loading, error, setError } = useResourceList(
    recordLoader,
    refreshKey,
    onLoading,
    { pollTick },
  )

  useToolbarPrimaryAction(isActive && !error ? 'Add record' : null, () =>
    setDialog({ mode: 'create', record: null }),
  )

  async function reloadRecords() {
    setError(null)
    setReloading(true)
    try {
      setItems(await recordLoader())
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setReloading(false)
    }
  }

  const filtered = applyFilter(
    items,
    filter,
    (r) => `${zoneName} ${r.type} ${r.name} ${r.content} ${r.comment ?? ''} ${r.tags.join(' ')}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { onRowContextMenu, menu: dnsMenu } = useLinkOnlyRowMenu(getRowLink)
  const [detail, setDetail] = useState<CloudflareDnsRecord | null>(null)

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {dnsMenu}
      {detail && (
        <LeafDetailPanel
          open
          onClose={() => setDetail(null)}
          title={`${detail.type}  ${detail.name}`}
          subtitle={`DNS record · ${zoneName}`}
          fields={[
            { label: 'Type', value: detail.type, mono: true },
            { label: 'Name', value: detail.name, mono: true },
            { label: 'Content', value: detail.content, mono: true, full: true },
            { label: 'TTL', value: formatTtl(detail.ttl) },
            {
              label: 'Proxy',
              value: detail.proxied === null ? '—' : detail.proxied ? 'On' : 'Off',
            },
            { label: 'Comment', value: detail.comment || '—' },
            {
              label: 'Updated',
              value: detail.modifiedAt ?? detail.createdAt ?? '—',
            },
          ]}
          raw={detail}
        />
      )}
      <Table<CloudflareDnsRecord>
        loading={loading || reloading}
        rows={filtered}
        rowKey={(r) => r.id}
        onPrimaryAction={setDetail}
        onRowContextMenu={onRowContextMenu}
        storageKey="cloudflare.dns-records"
        empty="No DNS records"
        columns={[
          {
            key: 'type',
            header: 'Type',
            width: 90,
            sortAccessor: (r) => r.type,
            render: (r) => <span className="font-mono text-[12px] text-main">{r.type}</span>,
          },
          {
            key: 'name',
            header: 'Name',
            width: 260,
            sortAccessor: (r) => r.name,
            render: (r) => (
              <span className="text-zViolet-accent truncate block max-w-[240px]" title={r.name}>
                {r.name}
              </span>
            ),
          },
          {
            key: 'content',
            header: 'Content',
            width: 320,
            sortAccessor: (r) => r.content,
            render: (r) => (
              <span
                className="font-mono text-[12px] text-secondary truncate block max-w-[300px]"
                title={r.content}
              >
                {r.content}
              </span>
            ),
          },
          {
            key: 'ttl',
            header: 'TTL',
            width: 90,
            sortAccessor: (r) => r.ttl,
            render: (r) => <span className="text-secondary">{formatTtl(r.ttl)}</span>,
          },
          {
            key: 'proxy',
            header: 'Proxy',
            width: 90,
            sortAccessor: (r) => (r.proxied ? 1 : 0),
            render: (r) =>
              r.proxied === null ? (
                '-'
              ) : r.proxied ? (
                <span className="text-[#f38020]">On</span>
              ) : (
                <span className="text-tertiary">Off</span>
              ),
          },
          {
            key: 'comment',
            header: 'Comment',
            width: 220,
            sortAccessor: (r) => r.comment ?? '',
            render: (r) => (
              <span
                className="text-secondary truncate block max-w-[200px]"
                title={r.comment ?? undefined}
              >
                {r.comment || '-'}
              </span>
            ),
          },
          {
            key: 'updated',
            header: 'Updated',
            width: 100,
            sortAccessor: (r) => r.modifiedAt ?? r.createdAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.modifiedAt ?? r.createdAt} />
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            width: 72,
            render: (r) => (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDialog({ mode: 'edit', record: r })
                  }}
                  className="w-6 h-6 rounded text-tertiary hover:bg-zGray-800 hover:text-main flex items-center justify-center"
                  title="Edit DNS record"
                >
                  <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingDelete(r)
                  }}
                  className="w-6 h-6 rounded text-tertiary hover:bg-error/15 hover:text-error flex items-center justify-center"
                  title="Delete DNS record"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                </button>
              </div>
            ),
          },
        ]}
      />

      <DnsRecordDialog
        open={!!dialog}
        zoneName={zoneName}
        record={dialog?.mode === 'edit' ? dialog.record : null}
        onClose={() => setDialog(null)}
        onSubmit={async (input) => {
          if (!dialog) return
          if (dialog.mode === 'edit') {
            await onUpdate(dialog.record.id, input)
          } else {
            await onCreate(input)
          }
          setDialog(null)
          await reloadRecords()
        }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete DNS record?"
        description={
          pendingDelete
            ? `${pendingDelete.type} ${pendingDelete.name} will be removed from ${zoneName}.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) {
            await onDelete(pendingDelete.id)
            await reloadRecords()
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
