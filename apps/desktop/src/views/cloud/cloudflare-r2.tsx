import { faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Modal } from '../../components/Modal'
import { Table } from '../../components/Table'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { useToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { resourceListCacheKey, withResourceListCache } from '../../lib/resourceListCache'
import { useResourceList } from '../useResourceList'

import { CloudflareR2BucketDetailView } from './cloudflare-r2-detail'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CfDetailRef, CfDrillProps, CfViewProps } from './cf-shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { CloudflareR2Bucket } from '../../types'

export function CloudflareR2View({
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
  const [pendingDelete, setPendingDelete] = useState<CloudflareR2Bucket | null>(null)
  const loader = useMemo<ResourceListLoader<CloudflareR2Bucket>>(
    () =>
      withResourceListCache(resourceListCacheKey('cloudflare', [teamId, accountId, 'r2']), () =>
        api.atlasListCloudflareR2Buckets(teamId, accountId),
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

  useToolbarPrimaryAction(isActive && !detail && !error ? 'Create bucket' : null, () =>
    setCreating(true),
  )

  const reload = useCallback(async () => {
    try {
      setItems(await api.atlasListCloudflareR2Buckets(teamId, accountId))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [teamId, accountId, setItems, setError])

  const filtered = applyFilter(
    items,
    filter,
    (b) => `${b.name} ${b.location ?? ''} ${b.storageClass ?? ''}`,
  )

  useEffect(() => {
    if (!detail) onCount(filtered.length)
  }, [filtered.length, onCount, detail])

  if (detail) {
    return (
      <CloudflareR2BucketDetailView
        teamId={teamId}
        accountId={accountId}
        bucketName={detail.name}
        prefix={detail.prefix ?? ''}
        onNavigate={(prefix) => setDetail({ name: detail.name, prefix })}
        onLoading={onLoading}
      />
    )
  }

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Table<CloudflareR2Bucket>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.name}
        onPrimaryAction={(r) => setDetail({ name: r.name })}
        storageKey="cloudflare.r2"
        empty="No R2 buckets"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 320,
            sortAccessor: (r) => r.name,
            render: (r) => (
              <span className="font-mono text-[12.5px] text-zViolet-accent">{r.name}</span>
            ),
          },
          {
            key: 'location',
            header: 'Location',
            width: 120,
            sortAccessor: (r) => r.location ?? '',
            render: (r) => <span className="text-secondary">{r.location || '-'}</span>,
          },
          {
            key: 'class',
            header: 'Storage class',
            width: 140,
            sortAccessor: (r) => r.storageClass ?? '',
            render: (r) => <span className="text-secondary">{r.storageClass || 'Standard'}</span>,
          },
          {
            key: 'created',
            header: 'Created',
            width: 110,
            sortAccessor: (r) => r.creationDate ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.creationDate} />
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
                  setPendingDelete(r)
                }}
                className="w-6 h-6 rounded text-tertiary hover:bg-error/15 hover:text-error flex items-center justify-center"
                title="Delete bucket"
              >
                <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
              </button>
            ),
          },
        ]}
      />

      {creating && (
        <CreateR2BucketDialog
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            await api.atlasCreateCloudflareR2Bucket(teamId, accountId, input)
            setCreating(false)
            toast.success('Bucket created')
            await reload()
          }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete bucket?"
        description={
          pendingDelete
            ? `Bucket "${pendingDelete.name}" must be empty to delete. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) {
            await api.atlasDeleteCloudflareR2Bucket(teamId, accountId, pendingDelete.name)
            toast.success('Bucket deleted')
            await reload()
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

function CreateR2BucketDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (input: { name: string; locationHint?: string; storageClass?: string }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [storageClass, setStorageClass] = useState('Standard')
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!name.trim()) {
      toast.error('Bucket name is required.')

      return
    }
    setSaving(true)
    try {
      await onCreate({ name: name.trim(), storageClass })
    } catch (e) {
      toast.apiError('Failed to create bucket', e, {
        fallback: 'Check your connection and try again.',
      })
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Create R2 bucket" width={460}>
      <div className="px-5 py-4 space-y-3 text-[13px]">
        <label className="block">
          <div className="text-[12px] text-secondary mb-1">Bucket name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-bucket"
            className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
          />
        </label>
        <label className="block">
          <div className="text-[12px] text-secondary mb-1">Storage class</div>
          <AppSelect
            value={storageClass}
            onValueChange={setStorageClass}
            options={[
              { value: 'Standard', label: 'Standard' },
              { value: 'InfrequentAccess', label: 'Infrequent Access' },
            ]}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => void create()}
          disabled={saving}
          className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </Modal>
  )
}
