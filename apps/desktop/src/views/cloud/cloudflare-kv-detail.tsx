import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'

import { CfDetailActionBar } from './cf-shared'
import { KvValueDialog } from './cloudflare-kv-value-dialog'
import { ErrorBlock } from './ErrorBlock'

import type { CloudflareKvKey } from '../../types'

export function CloudflareKvNamespaceDetailView({
  teamId,
  accountId,
  namespaceId,
  onLoading,
}: {
  teamId: string
  accountId: string
  namespaceId: string
  onLoading?: (loading: boolean) => void
}) {
  const [prefix, setPrefix] = useState('')
  const [editing, setEditing] = useState<{ key: string; value: string; isNew: boolean } | null>(
    null,
  )
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const query = useInfiniteQuery({
    queryKey: queryKeys.cloudflare(teamId, accountId, 'kv', namespaceId, 'keys', prefix),
    queryFn: ({ pageParam }) =>
      api.atlasListCloudflareKvKeys(teamId, accountId, namespaceId, prefix || undefined, pageParam),
    initialPageParam: null as string | null,
    // Cloudflare ends a listing with an empty cursor, not a missing one.
    getNextPageParam: (page) => page.cursor || null,
  })
  const keys = query.data?.pages.flatMap((page) => page.keys) ?? []
  const client = useQueryClient()
  // A write changes the listing under every prefix, not only the one on screen.
  const reload = () =>
    void client.invalidateQueries({
      queryKey: queryKeys.cloudflare(teamId, accountId, 'kv', namespaceId, 'keys'),
    })

  // Not polled, so a fetch is the first page or a reload after a write; "Load more" shows its own.
  useReportLoading(query.isFetching && !query.isFetchingNextPage, onLoading)

  async function openKey(key: string) {
    try {
      const v = await api.atlasReadCloudflareKvValue(teamId, accountId, namespaceId, key)

      setEditing({ key, value: v.value, isNew: false })
    } catch (e) {
      toast.apiError(t('Failed to read value'), e, {
        fallback: t('Check your connection and try again.'),
      })
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CfDetailActionBar>
        <button
          onClick={() => setEditing({ key: '', value: '', isNew: true })}
          className="h-7 px-2.5 rounded-md bg-surface-sunken hover:bg-state-hover text-secondary hover:text-main text-[12.5px] flex items-center gap-1.5"
        >
          <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" /> {t('Add key')}
        </button>
      </CfDetailActionBar>
      <div className="px-4 py-2 border-b border-line-control flex items-center gap-2">
        <input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder={t('Filter by key prefix…')}
          className="px-2.5 py-1.5 rounded-md bg-surface border border-line-control text-main outline-none focus:border-line-focus font-mono text-[12px] w-72"
        />
      </div>
      {query.error && !query.data ? (
        <ErrorBlock message={query.error.message} />
      ) : (
        <>
          <Table<CloudflareKvKey>
            loading={query.isPending}
            rows={keys}
            rowKey={(r) => r.name}
            onPrimaryAction={(r) => void openKey(r.name)}
            storageKey="cloudflare.kv.keys"
            empty={t('No keys')}
            columns={[
              {
                key: 'name',
                header: t('Key'),
                width: 420,
                sortAccessor: (r) => r.name,
                render: (r) => (
                  <span
                    className="font-mono text-[12.5px] text-main truncate block max-w-[400px]"
                    title={r.name}
                  >
                    {r.name}
                  </span>
                ),
              },
              {
                key: 'expiration',
                header: t('Expiration'),
                width: 160,
                sortAccessor: (r) => r.expiration ?? 0,
                render: (r) => (
                  <span className="text-tertiary">
                    {r.expiration ? new Date(r.expiration * 1000).toLocaleString() : '-'}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                width: 44,
                render: (r) => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(r.name)
                    }}
                    className="w-6 h-6 rounded text-tertiary hover:bg-error/15 hover:text-error flex items-center justify-center"
                    title={t('Delete key')}
                  >
                    <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                  </button>
                ),
              },
            ]}
          />
          {query.hasNextPage && (
            <div className="px-4 py-2 border-t border-line-control flex items-center justify-center">
              <button
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="px-3 py-1 rounded-md bg-surface-sunken hover:bg-state-hover text-secondary text-[12px] disabled:opacity-50"
              >
                {query.isFetchingNextPage ? t('Loading…') : t('Load more')}
              </button>
            </div>
          )}
        </>
      )}

      {editing && (
        <KvValueDialog
          initialKey={editing.key}
          initialValue={editing.value}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={async (key, value) => {
            await api.atlasWriteCloudflareKvValue(teamId, accountId, namespaceId, { key, value })
            setEditing(null)
            toast.success(t('Value saved'))
            reload()
          }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('Delete key?')}
        description={
          pendingDelete
            ? t('Key "{name}" will be permanently deleted.', { name: pendingDelete })
            : ''
        }
        confirmLabel={t('Delete')}
        destructive
        onConfirm={async () => {
          if (pendingDelete) {
            await api.atlasDeleteCloudflareKvValue(teamId, accountId, namespaceId, pendingDelete)
            toast.success(t('Key deleted'))
            reload()
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
