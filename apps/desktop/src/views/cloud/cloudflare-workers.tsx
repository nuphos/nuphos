import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { resourceListCacheKey, withResourceListCache } from '../../lib/resourceListCache'
import { useResourceList } from '../useResourceList'

import { CloudflareWorkerDetailView } from './cloudflare-worker-detail'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CfDetailRef, CfDrillProps, CfViewProps } from './cf-shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { CloudflareWorkerScript } from '../../types'

export function CloudflareWorkersView({
  teamId,
  accountId,
  filter,
  refreshKey,
  onCount,
  onLoading,
  detail: propDetail,
  setDetail: propSetDetail,
}: CfViewProps & CfDrillProps) {
  const { pollTick } = useWorkspaceTab()
  const [localDetail, setLocalDetail] = useState<CfDetailRef | null>(null)
  const detail = propDetail !== undefined ? propDetail : localDetail
  const setDetail = propSetDetail ?? setLocalDetail
  const loader = useMemo<ResourceListLoader<CloudflareWorkerScript>>(
    () =>
      withResourceListCache(
        resourceListCacheKey('cloudflare', [teamId, accountId, 'workers']),
        () => api.atlasListCloudflareWorkers(teamId, accountId),
      ),
    [teamId, accountId],
  )
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, {
    enabled: !detail,
    pollTick,
  })

  const filtered = applyFilter(items, filter, (s) => `${s.name} ${s.usageModel ?? ''}`)

  useEffect(() => {
    if (!detail) onCount(filtered.length)
  }, [filtered.length, onCount, detail])

  if (detail) {
    return (
      <CloudflareWorkerDetailView
        teamId={teamId}
        accountId={accountId}
        scriptName={detail.name}
        onBack={() => setDetail(null)}
        onLoading={onLoading}
      />
    )
  }

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Table<CloudflareWorkerScript>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.name}
        onPrimaryAction={(r) => setDetail({ name: r.name })}
        storageKey="cloudflare.workers"
        empty="No Workers"
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
            key: 'usage',
            header: 'Usage model',
            width: 140,
            sortAccessor: (r) => r.usageModel ?? '',
            render: (r) => <span className="text-secondary">{r.usageModel || '-'}</span>,
          },
          {
            key: 'modified',
            header: 'Modified',
            width: 110,
            sortAccessor: (r) => r.modifiedOn ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.modifiedOn} />
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}
