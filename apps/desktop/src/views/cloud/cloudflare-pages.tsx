import { faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { resourceListCacheKey, withResourceListCache } from '../../lib/resourceListCache'
import { useResourceList } from '../useResourceList'

import { CloudflarePagesProjectDetailView } from './cloudflare-pages-detail'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CfDetailRef, CfDrillProps, CfViewProps } from './cf-shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { CloudflarePagesProject } from '../../types'

export function CloudflarePagesView({
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
  const [pendingDelete, setPendingDelete] = useState<CloudflarePagesProject | null>(null)
  const loader = useMemo<ResourceListLoader<CloudflarePagesProject>>(
    () =>
      withResourceListCache(resourceListCacheKey('cloudflare', [teamId, accountId, 'pages']), () =>
        api.atlasListCloudflarePagesProjects(teamId, accountId),
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

  const reload = useCallback(async () => {
    try {
      setItems(await api.atlasListCloudflarePagesProjects(teamId, accountId))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [teamId, accountId, setItems, setError])

  const filtered = applyFilter(
    items,
    filter,
    (p) => `${p.name} ${p.productionBranch ?? ''} ${p.subdomain ?? ''}`,
  )

  useEffect(() => {
    if (!detail) onCount(filtered.length)
  }, [filtered.length, onCount, detail])

  if (detail) {
    return (
      <CloudflarePagesProjectDetailView
        teamId={teamId}
        accountId={accountId}
        projectName={detail.name}
        onLoading={onLoading}
      />
    )
  }

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Table<CloudflarePagesProject>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.name}
        onPrimaryAction={(r) => setDetail({ name: r.name })}
        storageKey="cloudflare.pages"
        empty="No Pages projects"
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
            key: 'branch',
            header: 'Production branch',
            width: 150,
            sortAccessor: (r) => r.productionBranch ?? '',
            render: (r) => <span className="text-secondary">{r.productionBranch || '-'}</span>,
          },
          {
            key: 'status',
            header: 'Latest',
            width: 120,
            sortAccessor: (r) => r.latestDeployment?.stageStatus ?? '',
            render: (r) =>
              r.latestDeployment?.stageStatus ? (
                <StatusBadge status={r.latestDeployment.stageStatus} />
              ) : (
                <span className="text-tertiary">-</span>
              ),
          },
          {
            key: 'domains',
            header: 'Domains',
            width: 90,
            sortAccessor: (r) => r.domains.length,
            render: (r) => <span className="text-secondary">{r.domains.length}</span>,
          },
          {
            key: 'created',
            header: 'Created',
            width: 110,
            sortAccessor: (r) => r.createdOn ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.createdOn} />
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
                title="Delete project"
              >
                <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
              </button>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete Pages project?"
        description={
          pendingDelete
            ? `Project "${pendingDelete.name}" and all its deployments will be deleted.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) {
            await api.atlasDeleteCloudflarePagesProject(teamId, accountId, pendingDelete.name)
            toast.success('Project deleted')
            await reload()
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
