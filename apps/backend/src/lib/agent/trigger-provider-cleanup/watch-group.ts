import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import { cleanupAws } from './aws'
import { cleanupBetterStack } from './betterstack'
import { cleanupGcp, gcpRequest, gcpToken, listAllGcpAlertPolicies } from './gcp'
import { cleanupGrafana } from './grafana'
import { cleanupConflict, sameJson, targetsManagedWebhook } from './shared'

import type { AgentTrigger } from '../trigger-db'
import type {
  AwsProviderWiring,
  BetterStackProviderWiring,
  GcpProviderWiring,
  GrafanaProviderWiring,
  MonitoringProviderWiring,
  WatchGroupProviderWiring,
} from '../trigger-provider-wiring'
import type { JsonObject } from './shared'

async function cleanupGcpGroup(
  teamId: ObjectId,
  triggerId: string,
  receipts: GcpProviderWiring[],
): Promise<void> {
  if (receipts.length === 0) return
  const first = receipts[0]!

  if (
    receipts.some(
      (receipt) =>
        receipt.projectId !== first.projectId ||
        receipt.serviceAccountEmail !== first.serviceAccountEmail ||
        receipt.notificationChannelName !== first.notificationChannelName,
    )
  ) {
    cleanupConflict(
      'A shared GCP Watch Group ingress must use one project and notification channel',
    )
  }
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { gcpServiceAccounts: 1 } },
  )
  const binding = (doc?.gcpServiceAccounts ?? []).find(
    (item) =>
      item.projectId === first.projectId &&
      item.serviceAccountEmail === first.serviceAccountEmail &&
      item.purpose !== 'permission-admin',
  )

  if (!binding)
    cleanupConflict('The GCP integration used by this Watch Group is no longer connected')

  const token = await gcpToken(first.serviceAccountEmail, teamId)
  const channel = await gcpRequest<JsonObject>(token, first.notificationChannelName, {}, true)

  if (channel) {
    const url = typeof channel.labels?.url === 'string' ? channel.labels.url : null

    if (channel.type !== 'webhook_tokenauth' || !targetsManagedWebhook(url, triggerId)) {
      cleanupConflict('The shared GCP notification channel no longer belongs to this Watch Group')
    }
  }

  for (const receipt of receipts) {
    const policy = await gcpRequest<JsonObject>(token, receipt.alertPolicyName, {}, true)

    if (!policy) continue
    const channels = Array.isArray(policy.notificationChannels) ? policy.notificationChannels : []

    if (!channels.includes(first.notificationChannelName)) continue
    const nextChannels = channels.filter((name: unknown) => name !== first.notificationChannelName)
    const preflight = await gcpRequest<JsonObject>(token, receipt.alertPolicyName, {}, true)

    if (!preflight || !sameJson(preflight.notificationChannels ?? [], channels)) {
      cleanupConflict(
        `GCP alert policy ${receipt.alertPolicyName} changed while group cleanup was preparing`,
      )
    }
    const updateMask = new URLSearchParams({ updateMask: 'notificationChannels' })

    await gcpRequest(token, `${receipt.alertPolicyName}?${String(updateMask)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: receipt.alertPolicyName,
        notificationChannels: nextChannels,
      }),
    })
  }

  const policies = await listAllGcpAlertPolicies(token, first.projectId)

  if (
    policies.some(
      (policy) =>
        Array.isArray(policy.notificationChannels) &&
        policy.notificationChannels.includes(first.notificationChannelName),
    )
  ) {
    cleanupConflict(
      'The shared GCP notification channel is still referenced outside this Watch Group',
    )
  }
  if (channel) {
    await gcpRequest(token, first.notificationChannelName, { method: 'DELETE' }, true)
  }
  if (await gcpRequest(token, first.notificationChannelName, {}, true)) {
    throw new AppError(
      502,
      'provider_cleanup_verification_failed',
      'Shared GCP notification channel still exists after deletion',
    )
  }
}

/**
 * Run same-provider member cleanup in order so shared mutable provider state
 * is never edited concurrently, while still attempting later members after a
 * conflict. The first failure is rethrown after the bounded sequence so a
 * retry remains visible without orphaning untouched later members.
 */
export async function settleSequentialProviderCleanup<T>(
  items: T[],
  cleanup: (item: T) => Promise<void>,
): Promise<void> {
  let firstError: { error: unknown } | undefined

  for (const item of items) {
    try {
      await cleanup(item)
    } catch (error) {
      firstError ??= { error }
    }
  }
  if (firstError) throw firstError.error
}

async function cleanupWatchGroup(
  teamId: ObjectId,
  triggerId: string,
  receipt: WatchGroupProviderWiring,
): Promise<void> {
  const grafana = receipt.wirings.filter(
    (wiring): wiring is GrafanaProviderWiring => wiring.provider === 'grafana',
  )
  const gcp = receipt.wirings.filter(
    (wiring): wiring is GcpProviderWiring => wiring.provider === 'gcp',
  )
  const aws = receipt.wirings.filter(
    (wiring): wiring is AwsProviderWiring => wiring.provider === 'aws',
  )
  const betterStack = receipt.wirings.filter(
    (wiring): wiring is BetterStackProviderWiring => wiring.provider === 'betterstack',
  )

  // The trigger is fenced before cleanup starts. Removing the shared route or
  // channel early therefore cannot deliver a half-cleaned event; each member
  // attachment is still independently read back and restored.
  await settleSequentialProviderCleanup(grafana, (wiring) =>
    cleanupGrafana(teamId, triggerId, wiring),
  )
  if (gcp.length > 0) await cleanupGcpGroup(teamId, triggerId, gcp)
  await settleSequentialProviderCleanup(aws, (wiring) => cleanupAws(teamId, triggerId, wiring))
  const seenWebhooks = new Set<string>()

  for (const wiring of betterStack) {
    if (seenWebhooks.has(wiring.outgoingWebhookId)) continue
    seenWebhooks.add(wiring.outgoingWebhookId)
    await cleanupBetterStack(teamId, triggerId, wiring)
  }
}

export async function cleanupManagedProviderWiring(
  trigger: AgentTrigger,
  triggerId: string,
  receipt: MonitoringProviderWiring,
): Promise<void> {
  if (!trigger.teamId || !ObjectId.isValid(trigger.teamId)) {
    cleanupConflict('This managed Watch has no valid team ownership')
  }
  const teamId = new ObjectId(trigger.teamId)

  if (receipt.provider === 'watch_group') {
    return cleanupWatchGroup(teamId, triggerId, receipt)
  }
  if (receipt.provider === 'grafana') return cleanupGrafana(teamId, triggerId, receipt)
  if (receipt.provider === 'gcp') return cleanupGcp(teamId, triggerId, receipt)
  if (receipt.provider === 'aws') return cleanupAws(teamId, triggerId, receipt)
  // Generic receipts deliberately describe dynamically wired provider
  // resources without pretending the backend knows how to mutate that API.
  // Trigger details and the removal preview disclose that these resources are
  // preserved and require the recorded manual cleanup procedure.
  if (receipt.provider === 'generic') return

  return cleanupBetterStack(teamId, triggerId, receipt)
}
