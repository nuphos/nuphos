import { faArrowsRotate, faPlay, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { refreshAfterWrite } from '../../lib/query/refreshAfterWrite'

import { CfDetailActionBar, CfMetaRow } from './cf-shared'
import { PagesDeploymentLogsModal, PagesDomainsSection } from './cloudflare-pages-sections'
import { ErrorBlock } from './ErrorBlock'

import type { CloudflarePagesDeploymentSummary } from '../../types'

export function CloudflarePagesProjectDetailView({
  teamId,
  accountId,
  projectName,
  onLoading,
}: {
  teamId: string
  accountId: string
  projectName: string
  onLoading?: (loading: boolean) => void
}) {
  const [logsFor, setLogsFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingRollback, setPendingRollback] = useState<string | null>(null)
  const query = useQuery({
    queryKey: queryKeys.cloudflare(teamId, accountId, 'pages', projectName),
    queryFn: async () => {
      const [project, deployments] = await Promise.all([
        api.atlasGetCloudflarePagesProject(teamId, accountId, projectName),
        api.atlasListCloudflarePagesDeployments(teamId, accountId, projectName),
      ])

      return { project, deployments }
    },
  })
  const { project = null, deployments = [] } = query.data ?? {}
  const client = useQueryClient()
  const reload = () =>
    void refreshAfterWrite(client, {
      queryKey: queryKeys.cloudflare(teamId, accountId, 'pages', projectName),
      exact: true,
    })

  // Not polled, so a fetch is either the first load or a reload after an action.
  useReportLoading(query.isFetching, onLoading)

  async function triggerDeploy() {
    setBusy(true)
    try {
      await api.atlasCreateCloudflarePagesDeployment(teamId, accountId, projectName)
      toast.success(t('Deployment triggered'))
      reload()
    } catch (e) {
      toast.apiError(t('Failed to trigger deployment'), e, {
        fallback: t('Check your connection and try again.'),
      })
    } finally {
      setBusy(false)
    }
  }

  async function retryDeployment(deploymentId: string) {
    try {
      await api.atlasRetryCloudflarePagesDeployment(teamId, accountId, projectName, deploymentId)
      toast.success(t('Retried'))
      reload()
    } catch (e) {
      toast.apiError(t('Failed to retry deployment'), e, {
        fallback: t('Check your connection and try again.'),
      })
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CfDetailActionBar>
        <button
          onClick={() => void triggerDeploy()}
          disabled={busy}
          className="h-7 px-2.5 rounded-md bg-surface-sunken hover:bg-state-hover text-secondary hover:text-main text-[12.5px] flex items-center gap-1.5 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faPlay} className="w-3.5 h-3.5" /> {t('Deploy')}
        </button>
      </CfDetailActionBar>
      {query.error && !query.data ? (
        <ErrorBlock message={query.error.message} />
      ) : !project ? (
        <div className="flex-1 flex items-center justify-center text-sm text-tertiary">
          {t('Loading…')}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-5 text-[12.5px]">
          <section>
            <div className="text-[12px] font-medium text-main mb-2">{t('Overview')}</div>
            <CfMetaRow
              label={t('Subdomain')}
              value={
                project.subdomain ? (
                  <a
                    className="text-link hover:underline"
                    onClick={() => {
                      if (project.subdomain) {
                        void api.appOpenExternal(`https://${project.subdomain}`)
                      }
                    }}
                  >
                    {project.subdomain}
                  </a>
                ) : (
                  '-'
                )
              }
            />
            <CfMetaRow label={t('Production branch')} value={project.productionBranch || '-'} />
            <CfMetaRow label={t('Source')} value={project.source || '-'} />
            <CfMetaRow
              label={t('Custom domains')}
              value={project.domains.length ? project.domains.join(', ') : '-'}
              mono
            />
          </section>

          <PagesDomainsSection teamId={teamId} accountId={accountId} projectName={projectName} />

          <section>
            <div className="text-[12px] font-medium text-main mb-2">{t('Deployments')}</div>
            <Table<CloudflarePagesDeploymentSummary>
              rows={deployments}
              rowKey={(r) => r.id}
              storageKey="cloudflare.pages.deployments"
              empty={t('No deployments')}
              columns={[
                {
                  key: 'short',
                  header: t('ID'),
                  width: 110,
                  render: (r) => (
                    <span className="font-mono text-[12px] text-secondary">
                      {r.shortId || r.id.slice(0, 8)}
                    </span>
                  ),
                },
                {
                  key: 'env',
                  header: t('Env'),
                  width: 100,
                  render: (r) => <span className="text-secondary">{r.environment || '-'}</span>,
                },
                {
                  key: 'branch',
                  header: t('Branch'),
                  width: 120,
                  render: (r) => <span className="text-secondary">{r.branch || '-'}</span>,
                },
                {
                  key: 'commit',
                  header: t('Commit'),
                  width: 240,
                  render: (r) => (
                    <span
                      className="text-tertiary truncate block max-w-[220px]"
                      title={r.commitMessage ?? undefined}
                    >
                      {r.commitHash ? r.commitHash.slice(0, 8) : ''} {r.commitMessage || ''}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: t('Status'),
                  width: 120,
                  render: (r) => (r.stageStatus ? <StatusBadge status={r.stageStatus} /> : '-'),
                },
                {
                  key: 'created',
                  header: t('Created'),
                  width: 100,
                  render: (r) => (
                    <span className="text-tertiary">
                      <Age value={r.createdOn} />
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  width: 110,
                  render: (r) => (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setLogsFor(r.id)}
                        className="px-1.5 h-6 rounded text-[11px] text-tertiary hover:bg-state-hover hover:text-main flex items-center"
                        title={t('Logs')}
                      >
                        {t('Logs')}
                      </button>
                      <button
                        onClick={() => void retryDeployment(r.id)}
                        className="w-6 h-6 rounded text-tertiary hover:bg-state-hover hover:text-main flex items-center justify-center"
                        title={t('Retry')}
                      >
                        <FontAwesomeIcon icon={faRotateLeft} className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setPendingRollback(r.id)}
                        className="w-6 h-6 rounded text-tertiary hover:bg-state-hover hover:text-main flex items-center justify-center"
                        title={t('Rollback to this deployment')}
                      >
                        <FontAwesomeIcon icon={faArrowsRotate} className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          </section>
        </div>
      )}

      {logsFor && (
        <PagesDeploymentLogsModal
          teamId={teamId}
          accountId={accountId}
          projectName={projectName}
          deploymentId={logsFor}
          onClose={() => setLogsFor(null)}
        />
      )}

      <ConfirmDialog
        open={!!pendingRollback}
        title={t('Roll back to this deployment?')}
        description={t('This changes the live production deployment for this Pages project.')}
        confirmLabel={t('Roll back')}
        destructive
        onConfirm={async () => {
          if (!pendingRollback) return
          try {
            await api.atlasRollbackCloudflarePagesDeployment(
              teamId,
              accountId,
              projectName,
              pendingRollback,
            )
            toast.success(t('Rolled back to this deployment'))
            reload()
          } catch (e) {
            toast.apiError(t('Failed to roll back deployment'), e, {
              fallback: t('Check your connection and try again.'),
            })
          }
        }}
        onClose={() => setPendingRollback(null)}
      />
    </div>
  )
}
