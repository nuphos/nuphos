import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { useResetOnKey } from '../useResetOnKey'

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
  const [keys, setKeys] = useState<CloudflareKvKey[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [prefix, setPrefix] = useState('')
  // The first listing is already in flight on mount, so start in the loading
  // state — the render-time reset only covers later prefix/namespace changes.
  const [loading, setLoading] = useState(true)
  const [paging, setPaging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ key: string; value: string; isNew: boolean } | null>(
    null,
  )
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const genRef = useRef(0)

  useReportLoading(loading, onLoading)

  const fetchKeys = useCallback(
    (p: string) => {
      const gen = ++genRef.current

      api
        .atlasListCloudflareKvKeys(teamId, accountId, namespaceId, p || undefined, null)
        .then((page) => {
          if (genRef.current !== gen) return
          setKeys(page.keys)
          setCursor(page.cursor)
          setLoading(false)
        })
        .catch((e: unknown) => {
          if (genRef.current !== gen) return
          setError(String(e instanceof Error ? e.message : e))
          setLoading(false)
        })
    },
    [teamId, accountId, namespaceId],
  )

  // Manual refresh handlers still go through `loadKeys` for the spinner; the
  // prefix-driven listing gets it from the render-time reset instead.
  const loadKeys = useCallback(
    (p: string) => {
      setLoading(true)
      setError(null)
      fetchKeys(p)
    },
    [fetchKeys],
  )

  useResetOnKey(`${teamId}|${accountId}|${namespaceId}|${prefix}`, () => {
    setLoading(true)
    setError(null)
  })
  useEffect(() => fetchKeys(prefix), [fetchKeys, prefix])

  const loadMore = useCallback(() => {
    if (!cursor || paging) return
    const gen = genRef.current

    setPaging(true)
    api
      .atlasListCloudflareKvKeys(teamId, accountId, namespaceId, prefix || undefined, cursor)
      .then((page) => {
        if (genRef.current !== gen) return
        setKeys((k) => [...k, ...page.keys])
        setCursor(page.cursor)
        setPaging(false)
      })
      .catch(() => setPaging(false))
  }, [cursor, paging, teamId, accountId, namespaceId, prefix])

  async function openKey(key: string) {
    try {
      const v = await api.atlasReadCloudflareKvValue(teamId, accountId, namespaceId, key)

      setEditing({ key, value: v.value, isNew: false })
    } catch (e) {
      toast.apiError('Failed to read value', e, {
        fallback: 'Check your connection and try again.',
      })
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CfDetailActionBar>
        <button
          onClick={() => setEditing({ key: '', value: '', isNew: true })}
          className="h-7 px-2.5 rounded-md bg-zGray-850 hover:bg-zGray-800 text-secondary hover:text-main text-[12.5px] flex items-center gap-1.5"
        >
          <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" /> Add key
        </button>
      </CfDetailActionBar>
      <div className="px-4 py-2 border-b border-zGray-850 flex items-center gap-2">
        <input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="Filter by key prefix…"
          className="px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12px] w-72"
        />
      </div>
      {error ? (
        <ErrorBlock message={error} />
      ) : (
        <>
          <Table<CloudflareKvKey>
            loading={loading}
            rows={keys}
            rowKey={(r) => r.name}
            onPrimaryAction={(r) => void openKey(r.name)}
            storageKey="cloudflare.kv.keys"
            empty="No keys"
            columns={[
              {
                key: 'name',
                header: 'Key',
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
                header: 'Expiration',
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
                    title="Delete key"
                  >
                    <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                  </button>
                ),
              },
            ]}
          />
          {cursor && (
            <div className="px-4 py-2 border-t border-zGray-850 flex items-center justify-center">
              <button
                onClick={loadMore}
                disabled={paging}
                className="px-3 py-1 rounded-md bg-zGray-850 hover:bg-zGray-800 text-secondary text-[12px] disabled:opacity-50"
              >
                {paging ? 'Loading…' : 'Load more'}
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
            toast.success('Value saved')
            loadKeys(prefix)
          }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete key?"
        description={pendingDelete ? `Key "${pendingDelete}" will be permanently deleted.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) {
            await api.atlasDeleteCloudflareKvValue(teamId, accountId, namespaceId, pendingDelete)
            toast.success('Key deleted')
            loadKeys(prefix)
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
