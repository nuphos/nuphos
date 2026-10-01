import clsx from 'clsx'
import { AlertTriangle, Check, Copy, ExternalLink, Webhook } from 'lucide-react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { CloudLogo } from '../../components/CloudLogo'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { PROVIDERS_WITH_LOGOS, providerLabel } from './providerLabels'

import type { ManagedProviderResourcePlan } from '../../api'

const OWNERSHIP_LABELS = {
  created: 'Created by Nuphos',
  modified: 'Modified by Nuphos',
  referenced: 'Referenced · preserved',
} as const

const CLEANUP_LABELS = {
  delete: 'Delete on removal',
  detach: 'Detach on removal',
  restore: 'Restore on removal',
  preserve: 'Preserved',
  manual: 'Manual cleanup',
} as const

const MONITORED_RESOURCE_KINDS = new Set([
  'alert_rule',
  'alert_policy',
  'monitor',
  'cloudwatch_alarm',
])

function providerResourceGroups(plan: ManagedProviderResourcePlan) {
  const monitored = plan.resources.filter(
    (resource) =>
      MONITORED_RESOURCE_KINDS.has(resource.kind) ||
      resource.ownership === 'modified' ||
      resource.ownership === 'referenced',
  )
  const delivery = plan.resources.filter((resource) => !monitored.includes(resource))

  return [
    { label: 'Monitored items', resources: monitored },
    { label: 'Delivery setup', resources: delivery },
  ].filter((group) => group.resources.length > 0)
}

export function ManagedProviderResourcesSection({
  plan,
  copied,
  copyKeyPrefix = 'provider-resource',
  onCopy,
  embedded = false,
}: {
  plan: ManagedProviderResourcePlan
  copied: string | null
  copyKeyPrefix?: string
  onCopy: (kind: string, value: string) => Promise<void>
  embedded?: boolean
}) {
  return (
    <section
      className={clsx(
        'overflow-hidden',
        !embedded && 'rounded-lg border border-zGray-800 bg-zGray-950',
      )}
    >
      {!embedded && (
        <div className="flex items-center justify-between gap-3 border-b border-zGray-800 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-zGray-900">
              {PROVIDERS_WITH_LOGOS.has(plan.provider) ? (
                <CloudLogo
                  provider={plan.provider as 'grafana' | 'gcp' | 'betterstack' | 'aws'}
                  size={15}
                />
              ) : (
                <Webhook className="h-[15px] w-[15px] text-zViolet-accent" strokeWidth={1.8} />
              )}
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-main">Provider resources</div>
              <div className="truncate text-[11px] text-tertiary">
                {providerLabel(plan)}
                {plan.integrationLabel ? ` · ${plan.integrationLabel}` : ''}
              </div>
            </div>
          </div>
          {plan.recordedAt && (
            <span className="flex-shrink-0 text-[10.5px] text-tertiary" title={plan.recordedAt}>
              Verified <Age value={plan.recordedAt} />
            </span>
          )}
        </div>
      )}

      <div>
        {providerResourceGroups(plan).map((group) => (
          <div key={group.label}>
            <div className="border-b border-zGray-800/80 bg-zGray-900/45 px-3 py-1.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-tertiary">
              {group.label}
            </div>
            <div className="divide-y divide-zGray-800/80">
              {group.resources.map((resource) => {
                const copyKey = `${copyKeyPrefix}-${resource.kind}-${resource.id}`

                return (
                  <div key={`${resource.kind}:${resource.id}`} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12px] font-medium text-main">{resource.name}</span>
                          <span
                            className={clsx(
                              'rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium',
                              resource.ownership === 'created' &&
                                'border-zViolet-500/35 bg-zViolet-500/10 text-zViolet-accent',
                              resource.ownership === 'modified' &&
                                'border-warning/35 bg-warning/10 text-warning',
                              resource.ownership === 'referenced' &&
                                'border-zGray-700 bg-zGray-900 text-secondary',
                            )}
                          >
                            {OWNERSHIP_LABELS[resource.ownership]}
                          </span>
                          <span className="rounded-full border border-zGray-800 px-1.5 py-0.5 text-[9.5px] text-tertiary">
                            {CLEANUP_LABELS[resource.cleanupAction]}
                          </span>
                        </div>
                        <p className="mt-1 text-[10.5px] leading-snug text-tertiary">
                          {resource.description}
                        </p>
                        <code className="mt-1.5 block break-all text-[10.5px] text-secondary">
                          {resource.id}
                        </code>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void onCopy(copyKey, resource.id)}
                          className="text-tertiary"
                          title={copied === copyKey ? 'Copied' : 'Copy resource ID'}
                          aria-label={`Copy ${resource.name} ID`}
                        >
                          {copied === copyKey ? (
                            <Check className="h-3.5 w-3.5 text-zGreen-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
                          )}
                        </Button>
                        {resource.url && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              void api.appOpenExternal(resource.url!).catch(() => {
                                toast.error('Could not open provider resource')
                              })
                            }}
                            className="text-tertiary"
                            title={`Open in ${providerLabel(plan)}`}
                            aria-label={`Open ${resource.name} in ${providerLabel(plan)}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 border-t border-warning/20 bg-warning/5 px-3 py-2 text-[10.5px] leading-snug text-secondary">
        <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0 text-warning" />
        <span>
          {plan.cleanupMode === 'manual'
            ? 'These resources were wired dynamically. Removing this Watch preserves them; follow the recorded manual cleanup step in the removal preview.'
            : 'These resources are part of this Watch. Removing them manually can interrupt delivery. Use Remove Watch to clean them up safely.'}
        </span>
      </div>
    </section>
  )
}

export function ProviderCleanupPreview({
  triggerName,
  plan,
}: {
  triggerName: string
  plan: ManagedProviderResourcePlan
}) {
  const changes = plan.cleanupSteps.filter(
    (step) => step.action !== 'preserve' && step.action !== 'manual',
  )
  const manual = plan.cleanupSteps.filter((step) => step.action === 'manual')
  const preserved = plan.cleanupSteps.filter((step) => step.action === 'preserve')

  return (
    <span className="block">
      <span className="block">
        {plan.cleanupMode === 'manual'
          ? `“${triggerName}” will be removed. Dynamically wired provider resources will be preserved and require the manual cleanup shown below.`
          : `“${triggerName}” will be removed together with the provider wiring Nuphos owns.`}
      </span>
      {changes.length > 0 && (
        <>
          <span className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-main">
            Will remove or change
          </span>
          <span className="mt-1.5 block space-y-1.5">
            {changes.map((step, index) => (
              <span
                key={`${step.action}:${String(step.resourceId ?? index)}`}
                className="flex items-start gap-2"
              >
                <span className="mt-[2px] flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-error/10 text-[9px] font-semibold text-error">
                  {index + 1}
                </span>
                <span className="min-w-0 break-words">{step.description}</span>
              </span>
            ))}
          </span>
        </>
      )}
      {manual.length > 0 && (
        <>
          <span className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-main">
            Manual provider cleanup
          </span>
          <span className="mt-1.5 block space-y-1.5">
            {manual.map((step, index) => (
              <span key={String(step.resourceId ?? index)} className="flex items-start gap-2">
                <AlertTriangle className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 text-warning" />
                <span className="min-w-0 break-words">{step.description}</span>
              </span>
            ))}
          </span>
        </>
      )}
      {preserved.length > 0 && (
        <>
          <span className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-main">
            Will preserve
          </span>
          <span className="mt-1.5 block space-y-1.5">
            {preserved.map((step, index) => (
              <span key={String(step.resourceId ?? index)} className="flex items-start gap-2">
                <Check className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 text-zGreen-400" />
                <span className="min-w-0 break-words">{step.description}</span>
              </span>
            ))}
          </span>
        </>
      )}
    </span>
  )
}
