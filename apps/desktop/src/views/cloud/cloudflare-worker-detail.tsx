import { faPencil, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'

import { CfDetailActionBar, CfMetaRow } from './cf-shared'
import { CronTriggersDialog } from './cloudflare-worker-dialogs'
import { ErrorBlock } from './ErrorBlock'

import type { CloudflareWorkerDeployment, CloudflareWorkerSettings } from '../../types'

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
  const [editingCron, setEditingCron] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const client = useQueryClient()
  const queryKey = queryKeys.cloudflare(teamId, accountId, 'workers', scriptName)
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const [settings, crons, deployments, subdomain] = await Promise.all([
        api.atlasGetCloudflareWorkerSettings(teamId, accountId, scriptName),
        api.atlasListCloudflareWorkerCronTriggers(teamId, accountId, scriptName),
        api.atlasListCloudflareWorkerDeployments(teamId, accountId, scriptName),
        api.atlasGetCloudflareWorkerSubdomain(teamId, accountId, scriptName).catch(() => null),
      ])

      return { settings, crons, deployments, subdomain }
    },
  })
  const { settings = null, crons = [], deployments = [], subdomain = null } = query.data ?? {}

  useReportLoading(query.isPending, onLoading)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CfDetailActionBar>
        <button
          onClick={() => setPendingDelete(true)}
          className="h-7 px-2.5 rounded-md text-tertiary hover:bg-error/15 hover:text-error text-[12.5px] flex items-center gap-1.5"
          title={t('Delete Worker')}
        >
          <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
          {t('Delete')}
        </button>
      </CfDetailActionBar>
      {query.error && !query.data ? (
        <ErrorBlock message={query.error.message} />
      ) : !query.data ? (
        <div className="flex-1 flex items-center justify-center text-sm text-tertiary">
          {t('Loading…')}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-5 text-[12.5px]">
          <section>
            <div className="text-[12px] font-medium text-main mb-2">{t('Configuration')}</div>
            <CfMetaRow
              label={t('Compatibility date')}
              value={settings?.compatibilityDate || '-'}
              mono
            />
            <CfMetaRow
              label={t('Compatibility flags')}
              value={
                settings?.compatibilityFlags.length ? settings.compatibilityFlags.join(', ') : '-'
              }
              mono
            />
            <CfMetaRow label={t('Usage model')} value={settings?.usageModel || '-'} />
            <CfMetaRow
              label={t('Observability')}
              value={
                settings?.observabilityEnabled == null
                  ? '-'
                  : settings.observabilityEnabled
                    ? t('Enabled')
                    : t('Disabled')
              }
            />
            <CfMetaRow
              label={t('workers.dev subdomain')}
              value={subdomain == null ? '-' : subdomain ? t('Enabled') : t('Disabled')}
            />
          </section>

          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] font-medium text-main">{t('Cron triggers')}</span>
              <button
                onClick={() => setEditingCron(true)}
                className="text-[12px] text-link hover:underline flex items-center gap-1"
              >
                <FontAwesomeIcon icon={faPencil} className="w-3 h-3" /> {t('Edit')}
              </button>
            </div>
            {crons.length === 0 ? (
              <div className="text-tertiary">{t('No cron triggers')}</div>
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
            <div className="text-[12px] font-medium text-main mb-2">{t('Bindings')}</div>
            {settings && settings.bindings.length > 0 ? (
              <Table<CloudflareWorkerBindingRow>
                rows={settings.bindings.map((b, i) => ({
                  ...b,
                  _k: `${b.type}:${b.name}:${String(i)}`,
                }))}
                rowKey={(r) => r._k}
                storageKey="cloudflare.worker.bindings"
                empty={t('No bindings')}
                columns={[
                  {
                    key: 'type',
                    header: t('Type'),
                    width: 160,
                    render: (r) => (
                      <span className="font-mono text-[12px] text-secondary">{r.type}</span>
                    ),
                  },
                  {
                    key: 'name',
                    header: t('Name'),
                    width: 200,
                    render: (r) => (
                      <span className="font-mono text-[12px] text-main">{r.name}</span>
                    ),
                  },
                  {
                    key: 'target',
                    header: t('Target'),
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
              <div className="text-tertiary">{t('No bindings')}</div>
            )}
          </section>

          <section>
            <div className="text-[12px] font-medium text-main mb-2">{t('Deployments')}</div>
            {deployments.length === 0 ? (
              <div className="text-tertiary">{t('No deployments')}</div>
            ) : (
              <Table<CloudflareWorkerDeployment>
                rows={deployments}
                rowKey={(r) => r.id}
                storageKey="cloudflare.worker.deployments"
                empty={t('No deployments')}
                columns={[
                  {
                    key: 'id',
                    header: t('ID'),
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
                    header: t('Source'),
                    width: 120,
                    render: (r) => <span className="text-secondary">{r.source || '-'}</span>,
                  },
                  {
                    key: 'author',
                    header: t('Author'),
                    width: 200,
                    render: (r) => <span className="text-tertiary">{r.authorEmail || '-'}</span>,
                  },
                  {
                    key: 'created',
                    header: t('Created'),
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

            // A read started before the save would bring the old triggers back.
            await client.cancelQueries({ queryKey, exact: true })
            client.setQueryData(
              queryKey,
              (cur: typeof query.data) => cur && { ...cur, crons: updated },
            )
            setEditingCron(false)
            toast.success(t('Cron triggers updated'))
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete}
        title={t('Delete Worker?')}
        description={t('Worker "{name}" will be permanently deleted. This cannot be undone.', {
          name: scriptName,
        })}
        confirmLabel={t('Delete')}
        destructive
        onConfirm={async () => {
          await api.atlasDeleteCloudflareWorker(teamId, accountId, scriptName)
          toast.success(t('Worker deleted'))
          onBack()
        }}
        onClose={() => setPendingDelete(false)}
      />
    </div>
  )
}

type CloudflareWorkerBindingRow = CloudflareWorkerSettings['bindings'][number] & { _k: string }
