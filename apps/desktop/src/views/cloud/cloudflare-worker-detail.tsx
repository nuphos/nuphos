import { faPencil, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { useResetOnKey } from '../useResetOnKey'

import { CfDetailActionBar, CfMetaRow } from './cf-shared'
import { CronTriggersDialog } from './cloudflare-worker-dialogs'
import { ErrorBlock } from './ErrorBlock'

import type {
  CloudflareWorkerCronTrigger,
  CloudflareWorkerDeployment,
  CloudflareWorkerSettings,
} from '../../types'

export function CloudflareWorkerDetailView({
  teamId,
  accountId,
  scriptName,
  onBack,
  onLoading,
}: {
  teamId: string
  accountId: string
  scriptName: string
  onBack: () => void
  onLoading?: (loading: boolean) => void
}) {
  const [settings, setSettings] = useState<CloudflareWorkerSettings | null>(null)
  const [crons, setCrons] = useState<CloudflareWorkerCronTrigger[]>([])
  const [deployments, setDeployments] = useState<CloudflareWorkerDeployment[]>([])
  const [subdomain, setSubdomain] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingCron, setEditingCron] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)

  useReportLoading(loading, onLoading)

  const load = useCallback(() => {
    Promise.all([
      api.atlasGetCloudflareWorkerSettings(teamId, accountId, scriptName),
      api.atlasListCloudflareWorkerCronTriggers(teamId, accountId, scriptName),
      api.atlasListCloudflareWorkerDeployments(teamId, accountId, scriptName),
      api.atlasGetCloudflareWorkerSubdomain(teamId, accountId, scriptName).catch(() => null),
    ])
      .then(([s, c, d, sub]) => {
        setSettings(s)
        setCrons(c)
        setDeployments(d)
        setSubdomain(sub)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })
  }, [teamId, accountId, scriptName])

  useResetOnKey(`${teamId}|${accountId}|${scriptName}`, () => {
    setLoading(true)
    setError(null)
  })
  useEffect(() => load(), [load])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CfDetailActionBar>
        <button
          onClick={() => setPendingDelete(true)}
          className="h-7 px-2.5 rounded-md text-tertiary hover:bg-error/15 hover:text-error text-[12.5px] flex items-center gap-1.5"
          title="Delete Worker"
        >
          <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
          Delete
        </button>
      </CfDetailActionBar>
      {error ? (
        <ErrorBlock message={error} />
      ) : loading && !settings ? (
        <div className="flex-1 flex items-center justify-center text-sm text-tertiary">
          Loading…
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-5 text-[12.5px]">
          <section>
            <div className="text-[12px] font-medium text-main mb-2">Configuration</div>
            <CfMetaRow label="Compatibility date" value={settings?.compatibilityDate || '-'} mono />
            <CfMetaRow
              label="Compatibility flags"
              value={
                settings?.compatibilityFlags.length ? settings.compatibilityFlags.join(', ') : '-'
              }
              mono
            />
            <CfMetaRow label="Usage model" value={settings?.usageModel || '-'} />
            <CfMetaRow
              label="Observability"
              value={
                settings?.observabilityEnabled == null
                  ? '-'
                  : settings.observabilityEnabled
                    ? 'Enabled'
                    : 'Disabled'
              }
            />
            <CfMetaRow
              label="workers.dev subdomain"
              value={subdomain == null ? '-' : subdomain ? 'Enabled' : 'Disabled'}
            />
          </section>

          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] font-medium text-main">Cron triggers</span>
              <button
                onClick={() => setEditingCron(true)}
                className="text-[12px] text-zViolet-accent hover:underline flex items-center gap-1"
              >
                <FontAwesomeIcon icon={faPencil} className="w-3 h-3" /> Edit
              </button>
            </div>
            {crons.length === 0 ? (
              <div className="text-tertiary">No cron triggers</div>
            ) : (
              <div className="space-y-1">
                {crons.map((c) => (
                  <div key={c.cron} className="font-mono text-[12px] text-secondary">
                    {c.cron}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="text-[12px] font-medium text-main mb-2">Bindings</div>
            {settings && settings.bindings.length > 0 ? (
              <Table<CloudflareWorkerBindingRow>
                rows={settings.bindings.map((b, i) => ({
                  ...b,
                  _k: `${b.type}:${b.name}:${String(i)}`,
                }))}
                rowKey={(r) => r._k}
                storageKey="cloudflare.worker.bindings"
                empty="No bindings"
                columns={[
                  {
                    key: 'type',
                    header: 'Type',
                    width: 160,
                    render: (r) => (
                      <span className="font-mono text-[12px] text-secondary">{r.type}</span>
                    ),
                  },
                  {
                    key: 'name',
                    header: 'Name',
                    width: 200,
                    render: (r) => (
                      <span className="font-mono text-[12px] text-main">{r.name}</span>
                    ),
                  },
                  {
                    key: 'target',
                    header: 'Target',
                    width: 280,
                    render: (r) => (
                      <span
                        className="font-mono text-[12px] text-tertiary truncate block max-w-[260px]"
                        title={r.target ?? undefined}
                      >
                        {r.target || '-'}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <div className="text-tertiary">No bindings</div>
            )}
          </section>

          <section>
            <div className="text-[12px] font-medium text-main mb-2">Deployments</div>
            {deployments.length === 0 ? (
              <div className="text-tertiary">No deployments</div>
            ) : (
              <Table<CloudflareWorkerDeployment>
                rows={deployments}
                rowKey={(r) => r.id}
                storageKey="cloudflare.worker.deployments"
                empty="No deployments"
                columns={[
                  {
                    key: 'id',
                    header: 'ID',
                    width: 280,
                    render: (r) => (
                      <span
                        className="font-mono text-[12px] text-secondary truncate block max-w-[260px]"
                        title={r.id}
                      >
                        {r.id}
                      </span>
                    ),
                  },
                  {
                    key: 'source',
                    header: 'Source',
                    width: 120,
                    render: (r) => <span className="text-secondary">{r.source || '-'}</span>,
                  },
                  {
                    key: 'author',
                    header: 'Author',
                    width: 200,
                    render: (r) => <span className="text-tertiary">{r.authorEmail || '-'}</span>,
                  },
                  {
                    key: 'created',
                    header: 'Created',
                    width: 110,
                    render: (r) => (
                      <span className="text-tertiary">
                        <Age value={r.createdOn} />
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </section>
        </div>
      )}

      {editingCron && (
        <CronTriggersDialog
          initial={crons.map((c) => c.cron)}
          onClose={() => setEditingCron(false)}
          onSave={async (next) => {
            const updated = await api.atlasUpdateCloudflareWorkerCronTriggers(
              teamId,
              accountId,
              scriptName,
              next,
            )

            setCrons(updated)
            setEditingCron(false)
            toast.success('Cron triggers updated')
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete}
        title="Delete Worker?"
        description={`Worker "${scriptName}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await api.atlasDeleteCloudflareWorker(teamId, accountId, scriptName)
          toast.success('Worker deleted')
          onBack()
        }}
        onClose={() => setPendingDelete(false)}
      />
    </div>
  )
}

type CloudflareWorkerBindingRow = CloudflareWorkerSettings['bindings'][number] & { _k: string }
