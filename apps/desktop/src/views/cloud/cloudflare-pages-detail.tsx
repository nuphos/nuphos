import { faArrowsRotate, faPlay, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { useResetOnKey } from '../useResetOnKey'

import { CfDetailActionBar, CfMetaRow } from './cf-shared'
import { PagesDeploymentLogsModal, PagesDomainsSection } from './cloudflare-pages-sections'
import { ErrorBlock } from './ErrorBlock'

import type { CloudflarePagesDeploymentSummary, CloudflarePagesProject } from '../../types'

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
  const [project, setProject] = useState<CloudflarePagesProject | null>(null)
  const [deployments, setDeployments] = useState<CloudflarePagesDeploymentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logsFor, setLogsFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingRollback, setPendingRollback] = useState<string | null>(null)

  useReportLoading(loading, onLoading)

  const load = useCallback(() => {
    Promise.all([
      api.atlasGetCloudflarePagesProject(teamId, accountId, projectName),
      api.atlasListCloudflarePagesDeployments(teamId, accountId, projectName),
    ])
      .then(([p, d]) => {
        setProject(p)
        setDeployments(d)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })
  }, [teamId, accountId, projectName])

  // Action handlers still go through `reload` for the spinner; the mount/param
  // fetch gets its spinner from the render-time reset instead.
  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    load()
  }, [load])

  useResetOnKey(`${teamId}|${accountId}|${projectName}`, () => {
    setLoading(true)
    setError(null)
  })
  useEffect(() => load(), [load])

  async function triggerDeploy() {
    setBusy(true)
    try {
      await api.atlasCreateCloudflarePagesDeployment(teamId, accountId, projectName)
      toast.success('Deployment triggered')
      reload()
    } catch (e) {
      toast.apiError('Failed to trigger deployment', e, {
        fallback: 'Check your connection and try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function retryDeployment(deploymentId: string) {
    try {
      await api.atlasRetryCloudflarePagesDeployment(teamId, accountId, projectName, deploymentId)
      toast.success('Retried')
      reload()
    } catch (e) {
      toast.apiError('Failed to retry deployment', e, {
        fallback: 'Check your connection and try again.',
      })
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CfDetailActionBar>
        <button
          onClick={() => void triggerDeploy()}
          disabled={busy}
          className="h-7 px-2.5 rounded-md bg-zGray-850 hover:bg-zGray-800 text-secondary hover:text-main text-[12.5px] flex items-center gap-1.5 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faPlay} className="w-3.5 h-3.5" /> Deploy
        </button>
      </CfDetailActionBar>
      {error ? (
        <ErrorBlock message={error} />
      ) : loading && !project ? (
        <div className="flex-1 flex items-center justify-center text-sm text-tertiary">
          Loading…
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-5 text-[12.5px]">
          <section>
            <div className="text-[12px] font-medium text-main mb-2">Overview</div>
            <CfMetaRow
              label="Subdomain"
              value={
                project?.subdomain ? (
                  <a
                    className="text-zViolet-accent hover:underline"
                    onClick={() => {
                      if (project?.subdomain) {
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
            <CfMetaRow label="Production branch" value={project?.productionBranch || '-'} />
            <CfMetaRow label="Source" value={project?.source || '-'} />
            <CfMetaRow
              label="Custom domains"
              value={project?.domains.length ? project.domains.join(', ') : '-'}
              mono
            />
          </section>

          <PagesDomainsSection teamId={teamId} accountId={accountId} projectName={projectName} />

          <section>
            <div className="text-[12px] font-medium text-main mb-2">Deployments</div>
            <Table<CloudflarePagesDeploymentSummary>
              rows={deployments}
              rowKey={(r) => r.id}
              storageKey="cloudflare.pages.deployments"
              empty="No deployments"
              columns={[
                {
                  key: 'short',
                  header: 'ID',
                  width: 110,
                  render: (r) => (
                    <span className="font-mono text-[12px] text-secondary">
                      {r.shortId || r.id.slice(0, 8)}
                    </span>
                  ),
                },
                {
                  key: 'env',
                  header: 'Env',
                  width: 100,
                  render: (r) => <span className="text-secondary">{r.environment || '-'}</span>,
                },
                {
                  key: 'branch',
                  header: 'Branch',
                  width: 120,
                  render: (r) => <span className="text-secondary">{r.branch || '-'}</span>,
                },
                {
                  key: 'commit',
                  header: 'Commit',
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
                  header: 'Status',
                  width: 120,
                  render: (r) => (r.stageStatus ? <StatusBadge status={r.stageStatus} /> : '-'),
                },
                {
                  key: 'created',
                  header: 'Created',
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
                        className="px-1.5 h-6 rounded text-[11px] text-tertiary hover:bg-zGray-800 hover:text-main flex items-center"
                        title="Logs"
                      >
                        Logs
                      </button>
                      <button
                        onClick={() => void retryDeployment(r.id)}
                        className="w-6 h-6 rounded text-tertiary hover:bg-zGray-800 hover:text-main flex items-center justify-center"
                        title="Retry"
                      >
                        <FontAwesomeIcon icon={faRotateLeft} className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setPendingRollback(r.id)}
                        className="w-6 h-6 rounded text-tertiary hover:bg-zGray-800 hover:text-main flex items-center justify-center"
                        title="Rollback to this deployment"
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
        title="Roll back to this deployment?"
        description="This changes the live production deployment for this Pages project."
        confirmLabel="Roll back"
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
            toast.success('Rolled back to this deployment')
            reload()
          } catch (e) {
            toast.apiError('Failed to roll back deployment', e, {
              fallback: 'Check your connection and try again.',
            })
          }
        }}
        onClose={() => setPendingRollback(null)}
      />
    </div>
  )
}
