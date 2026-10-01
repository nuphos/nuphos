import { faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { resourceListCacheKey, withResourceListCache } from '../../lib/resourceListCache'
import { useResourceList } from '../useResourceList'

import { CreateNameDialog } from './cf-shared'
import { CloudflareD1DatabaseDetailView } from './cloudflare-d1-detail'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter, formatBytes } from './shared'

import type { CfDetailRef, CfDrillProps, CfViewProps } from './cf-shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { CloudflareD1Database } from '../../types'

export function CloudflareD1View({
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
  const [pendingDelete, setPendingDelete] = useState<CloudflareD1Database | null>(null)
  const loader = useMemo<ResourceListLoader<CloudflareD1Database>>(
    () =>
      withResourceListCache(resourceListCacheKey('cloudflare', [teamId, accountId, 'd1']), () =>
        api.atlasListCloudflareD1Databases(teamId, accountId),
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

  useToolbarPrimaryAction(isActive && !detail && !error ? 'Create database' : null, () =>
    setCreating(true),
  )

  const reload = useCallback(async () => {
    try {
      setItems(await api.atlasListCloudflareD1Databases(teamId, accountId))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [teamId, accountId, setItems, setError])

  const filtered = applyFilter(items, filter, (d) => `${d.name} ${d.uuid}`)

  useEffect(() => {
    if (!detail) onCount(filtered.length)
  }, [filtered.length, onCount, detail])

  if (detail) {
    if (!detail.id) {
      return <ErrorBlock message={`Could not open ${detail.name}: missing D1 database ID.`} />
    }

    return (
      <CloudflareD1DatabaseDetailView
        teamId={teamId}
        accountId={accountId}
        databaseId={detail.id}
        onLoading={onLoading}
      />
    )
  }

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Table<CloudflareD1Database>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.uuid}
        onPrimaryAction={(r) => setDetail({ id: r.uuid, name: r.name })}
        storageKey="cloudflare.d1"
        empty="No D1 databases"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 240,
            sortAccessor: (r) => r.name,
            render: (r) => (
              <span className="font-mono text-[12.5px] text-zViolet-accent">{r.name}</span>
            ),
          },
          {
            key: 'region',
            header: 'Region',
            width: 110,
            sortAccessor: (r) => r.runningInRegion ?? '',
            render: (r) => <span className="text-secondary">{r.runningInRegion || '-'}</span>,
          },
          {
            key: 'tables',
            header: 'Tables',
            width: 80,
            sortAccessor: (r) => r.numTables ?? 0,
            render: (r) => <span className="text-secondary">{r.numTables ?? '-'}</span>,
          },
          {
            key: 'size',
            header: 'Size',
            width: 100,
            sortAccessor: (r) => r.fileSize ?? 0,
            render: (r) => (
              <span className="text-secondary">
                {r.fileSize != null ? formatBytes(r.fileSize) : '-'}
              </span>
            ),
          },
          {
            key: 'created',
            header: 'Created',
            width: 110,
            sortAccessor: (r) => r.createdAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.createdAt} />
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            width: 42,
            render: (r) => (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingDelete(r)
                  }}
                  className="w-6 h-6 rounded text-tertiary hover:bg-error/15 hover:text-error flex items-center justify-center"
                  title="Delete database"
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
          title="Create D1 database"
          label="Database name"
          placeholder="my-database"
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            await api.atlasCreateCloudflareD1Database(teamId, accountId, { name })
            setCreating(false)
            toast.success('Database created')
            await reload()
          }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete D1 database?"
        description={
          pendingDelete
            ? `Database "${pendingDelete.name}" and all its data will be permanently deleted.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) {
            await api.atlasDeleteCloudflareD1Database(teamId, accountId, pendingDelete.uuid)
            toast.success('Database deleted')
            await reload()
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
