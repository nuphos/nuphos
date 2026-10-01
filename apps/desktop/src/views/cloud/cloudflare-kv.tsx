import { faPencil, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { resourceListCacheKey, withResourceListCache } from '../../lib/resourceListCache'
import { useResourceList } from '../useResourceList'

import { CreateNameDialog } from './cf-shared'
import { CloudflareKvNamespaceDetailView } from './cloudflare-kv-detail'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CfDetailRef, CfDrillProps, CfViewProps } from './cf-shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { CloudflareKvNamespace } from '../../types'

export function CloudflareKvView({
  teamId,
  accountId,
  filter,
  refreshKey,
  onCount,
  onLoading,
  detail: propDetail,
  setDetail: propSetDetail,
}: CfViewProps & CfDrillProps) {
  const { pollTick, isActive } = useWorkspaceTab()
  const [localDetail, setLocalDetail] = useState<CfDetailRef | null>(null)
  const detail = propDetail !== undefined ? propDetail : localDetail
  const setDetail = propSetDetail ?? setLocalDetail
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<CloudflareKvNamespace | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CloudflareKvNamespace | null>(null)
  const loader = useMemo<ResourceListLoader<CloudflareKvNamespace>>(
    () =>
      withResourceListCache(resourceListCacheKey('cloudflare', [teamId, accountId, 'kv']), () =>
        api.atlasListCloudflareKvNamespaces(teamId, accountId),
      ),
    [teamId, accountId],
  )
  const { items, setItems, loading, error, setError } = useResourceList(
    loader,
    refreshKey,
    onLoading,
    {
      enabled: !detail,
      pollTick,
    },
  )

  useToolbarPrimaryAction(isActive && !detail && !error ? 'Create namespace' : null, () =>
    setCreating(true),
  )

  const reload = useCallback(async () => {
    try {
      setItems(await api.atlasListCloudflareKvNamespaces(teamId, accountId))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [teamId, accountId, setItems, setError])

  const filtered = applyFilter(items, filter, (n) => `${n.title} ${n.id}`)

  useEffect(() => {
    if (!detail) onCount(filtered.length)
  }, [filtered.length, onCount, detail])

  if (detail) {
    if (!detail.id) {
      return <ErrorBlock message={`Could not open ${detail.name}: missing KV namespace ID.`} />
    }

    return (
      <CloudflareKvNamespaceDetailView
        teamId={teamId}
        accountId={accountId}
        namespaceId={detail.id}
        onLoading={onLoading}
      />
    )
  }

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Table<CloudflareKvNamespace>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.id}
        onPrimaryAction={(r) => setDetail({ id: r.id, name: r.title })}
        storageKey="cloudflare.kv"
        empty="No KV namespaces"
        columns={[
          {
            key: 'title',
            header: 'Title',
            width: 280,
            sortAccessor: (r) => r.title,
            render: (r) => (
              <span className="font-mono text-[12.5px] text-zViolet-accent">{r.title}</span>
            ),
          },
          {
            key: 'id',
            header: 'Namespace ID',
            width: 280,
            sortAccessor: (r) => r.id,
            render: (r) => <span className="font-mono text-[12px] text-tertiary">{r.id}</span>,
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
                    setRenaming(r)
                  }}
                  className="w-6 h-6 rounded text-tertiary hover:bg-zGray-800 hover:text-main flex items-center justify-center"
                  title="Rename"
                >
                  <FontAwesomeIcon icon={faPencil} className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingDelete(r)
                  }}
                  className="w-6 h-6 rounded text-tertiary hover:bg-error/15 hover:text-error flex items-center justify-center"
                  title="Delete namespace"
                >
                  <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                </button>
              </div>
            ),
          },
        ]}
      />

      {creating && (
        <CreateNameDialog
          title="Create KV namespace"
          label="Title"
          placeholder="my-namespace"
          onClose={() => setCreating(false)}
          onCreate={async (title) => {
            await api.atlasCreateCloudflareKvNamespace(teamId, accountId, title)
            setCreating(false)
            toast.success('Namespace created')
            await reload()
          }}
        />
      )}

      {renaming && (
        <CreateNameDialog
          title="Rename namespace"
          label="Title"
          placeholder="my-namespace"
          initial={renaming.title}
          confirmLabel="Rename"
          onClose={() => setRenaming(null)}
          onCreate={async (title) => {
            await api.atlasRenameCloudflareKvNamespace(teamId, accountId, renaming.id, title)
            setRenaming(null)
            toast.success('Namespace renamed')
            await reload()
          }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete KV namespace?"
        description={
          pendingDelete
            ? `Namespace "${pendingDelete.title}" and all its keys will be permanently deleted.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) {
            await api.atlasDeleteCloudflareKvNamespace(teamId, accountId, pendingDelete.id)
            toast.success('Namespace deleted')
            await reload()
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
