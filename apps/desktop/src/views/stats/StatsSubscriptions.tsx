import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../hooks/useRuntimeQuotas'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'
import { quotaNote, quotaWindowLine } from '../../lib/runtimeQuota'
import { agentName, agentRunsOn, visibleAgent } from '../settings/agentPresentation'

export function StatsSubscriptions({ teamId }: { teamId: string }) {
  const catalog = useRuntimeInstances(teamId)
  const quotas = useRuntimeQuotas(teamId)
  const computer = useThisComputer()
  const instances = catalog.instances.filter(visibleAgent)

  if (catalog.loading) return <p className="text-sm text-tertiary">{t('Loading...')}</p>
  if (catalog.error) return <p className="text-sm text-tertiary">{t('Could not load agents')}</p>
  if (!instances.length) return <p className="text-sm text-tertiary">{t('No agents yet.')}</p>

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-start gap-4">
      {instances.map((instance) => {
        const quota = quotas.get(instance.id)
        const windows = quota?.available ? quota.windows : []

        return (
          <section key={instance.id} className="rounded-xl border border-line-control p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-main">
              <AgentProviderIcon provider={instance.provider} className="size-4" />
              {agentName(instance)}
            </div>
            <p className="mb-4 text-xs text-tertiary">
              {agentRunsOn(instance, computer?.deviceId, quota)}
              {quota?.plan ? ` · ${quota.plan}` : ''}
            </p>
            {!windows.length && (
              <p className="text-xs text-tertiary">{quotaNote(quota) ?? t('No data yet')}</p>
            )}
            <div className="space-y-4">
              {windows.map((window) => {
                const left = Math.max(0, Math.min(100, 100 - window.usedPercent))

                return (
                  <div key={window.id} title={quotaWindowLine(window, new Date())}>
                    <div className="mb-2 flex items-center justify-between gap-4 text-xs text-secondary">
                      <span>{window.label}</span>
                      <span>{t('{percent}% left', { percent: Math.round(left) })}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${agentName(instance)} · ${window.label}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={left}
                      className="h-2 overflow-hidden rounded-full bg-surface-sunken"
                    >
                      <div
                        className="h-full rounded-full bg-action-primary"
                        style={{ width: `${String(left)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-tertiary">
                      {quotaWindowLine(window, new Date())}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
