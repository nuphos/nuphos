import clsx from 'clsx'
import { AlertTriangle, Eye, EyeOff, Loader2, Webhook } from 'lucide-react'

import { Age } from '../../components/Age'
import { CloudLogo } from '../../components/CloudLogo'
import { VisibleErrorReporter } from '../../components/VisibleErrorReporter'

import { CopyableRow } from './parts'
import { PROVIDER_LABELS, PROVIDERS_WITH_LOGOS } from './providerLabels'
import { ManagedProviderResourcesSection } from './providerResources'
import { stripTrailingSlashes } from './shared'

import type { GroupIngressDetails } from './groupOverviewLogic'
import type { AgentTrigger, AgentTriggerGroup } from '../../api'

export function GroupProviderSetup({
  group,
  triggers,
  ingresses,
  loading,
  atlasApiUrl,
  canManage,
  copied,
  revealSecrets,
  setRevealSecrets,
  copy,
}: {
  group: AgentTriggerGroup
  triggers: AgentTrigger[]
  ingresses: GroupIngressDetails[]
  loading: boolean
  atlasApiUrl?: string
  canManage: boolean
  copied: string | null
  revealSecrets: Record<string, boolean>
  setRevealSecrets: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  copy: (kind: string, value: string) => Promise<void>
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          Provider setup
        </h3>
        <span className="text-[10.5px] text-tertiary">
          One shared ingress per provider integration
        </span>
      </div>

      <div className="space-y-3">
        {group.partitions.map((partition) => {
          const loadedDetails = ingresses.find((entry) => entry.triggerId === partition.triggerId)
          const listedTrigger = triggers.find((trigger) => trigger.id === partition.triggerId)
          const trigger = loadedDetails?.trigger ?? listedTrigger
          const plan = loadedDetails?.trigger?.managedProviderResources
          const providerName =
            plan?.providerLabel ?? PROVIDER_LABELS[partition.provider] ?? partition.provider
          const ready = Boolean(trigger?.providerWiring)
          const webhookUrl =
            trigger && atlasApiUrl
              ? `${stripTrailingSlashes(atlasApiUrl)}/webhooks/${trigger.id}`
              : null
          const secretKey = `secret-${partition.triggerId}`

          return (
            <section
              key={partition.key}
              className="overflow-hidden rounded-lg border border-zGray-800 bg-zGray-950"
            >
              <div className="flex items-center gap-3 border-b border-zGray-800 px-3 py-2.5">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-zGray-900">
                  {PROVIDERS_WITH_LOGOS.has(partition.provider) ? (
                    <CloudLogo
                      provider={partition.provider as 'grafana' | 'gcp' | 'betterstack' | 'aws'}
                      size={15}
                    />
                  ) : (
                    <Webhook className="h-[15px] w-[15px] text-zViolet-accent" strokeWidth={1.8} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12.5px] font-medium text-main">{providerName}</span>
                    <span
                      className={clsx(
                        'rounded-full border px-1.5 py-0.5 text-[9.5px]',
                        loadedDetails?.error
                          ? 'border-error/35 text-error'
                          : ready
                            ? 'border-zGreen-500/35 text-zGreen-300'
                            : 'border-zViolet-500/35 text-zViolet-accent',
                      )}
                    >
                      {loadedDetails?.error ? 'Unavailable' : ready ? 'Connected' : 'Provisioning'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] text-tertiary">
                    {partition.integrationId} · {partition.memberKeys.length} selected item
                    {partition.memberKeys.length === 1 ? '' : 's'}
                  </div>
                </div>
                {plan?.recordedAt && (
                  <span
                    className="flex-shrink-0 text-[10.5px] text-tertiary"
                    title={plan.recordedAt}
                  >
                    Verified <Age value={plan.recordedAt} />
                  </span>
                )}
              </div>

              {loading && !loadedDetails ? (
                <div className="flex items-center gap-2 px-3 py-4 text-[11.5px] text-tertiary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading provider setup…
                </div>
              ) : loadedDetails?.error ? (
                <div className="px-3 py-3 text-[11.5px] text-error">
                  <VisibleErrorReporter
                    message={loadedDetails.error}
                    surface="trigger_ingress_load_error"
                  />
                  Could not load this ingress: {loadedDetails.error}
                </div>
              ) : (
                <>
                  <div className="space-y-2.5 border-b border-zGray-800 px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                      Webhook ingress
                    </div>
                    {webhookUrl && (
                      <CopyableRow
                        label="Webhook URL"
                        value={webhookUrl}
                        copied={copied === `url-${partition.triggerId}`}
                        onCopy={() => void copy(`url-${partition.triggerId}`, webhookUrl)}
                      />
                    )}
                    {canManage && trigger?.webhookSecret && (
                      <CopyableRow
                        label="Webhook secret"
                        value={trigger.webhookSecret}
                        hidden={!revealSecrets[secretKey]}
                        copied={copied === secretKey}
                        onCopy={() => void copy(secretKey, trigger.webhookSecret!)}
                        rightAction={
                          <button
                            type="button"
                            onClick={() =>
                              setRevealSecrets((current) => ({
                                ...current,
                                [secretKey]: !current[secretKey],
                              }))
                            }
                            aria-label={revealSecrets[secretKey] ? 'Hide secret' : 'Reveal secret'}
                            className="flex h-6 w-6 items-center justify-center rounded text-tertiary hover:text-main"
                          >
                            {revealSecrets[secretKey] ? (
                              <EyeOff className="h-3.5 w-3.5" strokeWidth={1.8} />
                            ) : (
                              <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
                            )}
                          </button>
                        }
                      />
                    )}
                    <p className="text-[11.5px] leading-snug text-tertiary">
                      Send this provider's secret in the{' '}
                      <code className="text-[11px]">X-Webhook-Secret</code> header.
                    </p>
                  </div>
                  {plan ? (
                    <ManagedProviderResourcesSection
                      plan={plan}
                      copied={copied}
                      copyKeyPrefix={`group-${partition.key}`}
                      onCopy={copy}
                      embedded
                    />
                  ) : (
                    <div className="flex items-start gap-2 px-3 py-3 text-[11.5px] leading-snug text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        Setup is incomplete. Provider resources were not recorded, so this ingress
                        is not published yet. Resume the Agent setup and finalize its provider
                        receipt before testing or publishing the group.
                      </span>
                    </div>
                  )}
                </>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
