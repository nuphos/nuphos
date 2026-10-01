import { ObjectId } from 'mongodb'

import { listBetterStackOutgoingWebhooks } from '@/lib/byos/betterstack'
import { decryptBetterStackToken } from '@/lib/byos/secrets'
import { teamByosBindings } from '@/models'

import { gcpRequest, gcpToken, listAllGcpAlertPolicies } from './gcp'
import { findMatchingRoutes, grafanaContactPointUrl, grafanaRequest } from './grafana-api'
import { cleanupConflict, targetsManagedWebhook } from './shared'

import type { AgentTrigger } from '../trigger-db'
import type {
  BetterStackProviderWiring,
  GcpProviderWiring,
  GrafanaProviderWiring,
  MonitoringProviderWiring,
} from '../trigger-provider-wiring'
import type { JsonObject } from './shared'

function likelyLegacyProvider(trigger: AgentTrigger): string | null {
  return trigger.monitoringIdentity?.provider ?? trigger.legacyMonitoringProvider ?? null
}

export function isPotentialLegacyManagedWatch(trigger: AgentTrigger): boolean {
  return likelyLegacyProvider(trigger) !== null
}

async function discoverLegacyGrafana(
  teamId: ObjectId,
  triggerId: string,
): Promise<GrafanaProviderWiring | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { grafanaInstances: 1 } },
  )
  const bindings = doc?.grafanaInstances ?? []

  if (bindings.length === 0) {
    cleanupConflict('The Grafana integration used by this legacy Watch is no longer connected')
  }
  const candidates: GrafanaProviderWiring[] = []

  for (const binding of bindings) {
    const contactPoints =
      (await grafanaRequest<JsonObject[]>(binding, '/api/v1/provisioning/contact-points')) ?? []
    const owned = contactPoints.filter((item) =>
      targetsManagedWebhook(grafanaContactPointUrl(item), triggerId),
    )

    if (owned.length === 0) continue
    if (owned.length > 1)
      cleanupConflict('Multiple Grafana contact points target this legacy Watch')
    const rules =
      (await grafanaRequest<JsonObject[]>(binding, '/api/v1/provisioning/alert-rules')) ?? []
    const labelled = rules.flatMap((rule) =>
      Object.entries(rule.labels ?? {})
        .filter(([, value]) => value === triggerId)
        .map(([labelKey]) => ({ rule, labelKey })),
    )

    if (labelled.length !== 1) {
      cleanupConflict('Could not uniquely identify the Grafana alert rule for this legacy Watch')
    }
    const policy = await grafanaRequest<JsonObject>(binding, '/api/v1/provisioning/policies')

    if (!policy) cleanupConflict('Grafana returned no notification policy for this legacy Watch')
    const contactPoint = owned[0]!
    const { rule, labelKey } = labelled[0]!
    const routes = findMatchingRoutes(policy, labelKey, triggerId)
    const managed = routes.filter((route) => route.receiver === contactPoint.name)

    if (managed.length !== 1)
      cleanupConflict('Could not uniquely identify the Grafana route for this legacy Watch')
    const compatibility = routes.some((route) => route.receiver !== contactPoint.name)

    candidates.push({
      provider: 'grafana',
      integrationId: binding.id.toHexString(),
      alertRuleUid: String(rule.uid),
      contactPointUid: String(contactPoint.uid),
      contactPointName: String(contactPoint.name),
      labelKey,
      labelValue: triggerId,
      routingMode: compatibility ? 'legacy_preserve_compatibility' : 'policy',
    })
  }
  if (candidates.length > 1)
    cleanupConflict('This legacy Watch was found in more than one Grafana integration')

  return candidates[0] ?? null
}

async function listAllGcpChannels(token: string, projectId: string): Promise<JsonObject[]> {
  const channels: JsonObject[] = []
  let pageToken: string | undefined

  do {
    const query = new URLSearchParams({ pageSize: '1000' })

    if (pageToken) query.set('pageToken', pageToken)
    const page = await gcpRequest<JsonObject>(
      token,
      `projects/${encodeURIComponent(projectId)}/notificationChannels?${String(query)}`,
    )

    channels.push(...(Array.isArray(page?.notificationChannels) ? page.notificationChannels : []))
    pageToken = typeof page?.nextPageToken === 'string' ? page.nextPageToken : undefined
  } while (pageToken)

  return channels
}

async function discoverLegacyGcp(
  teamId: ObjectId,
  triggerId: string,
): Promise<GcpProviderWiring | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { gcpServiceAccounts: 1 } },
  )
  const bindings = (doc?.gcpServiceAccounts ?? []).filter(
    (item) => item.purpose !== 'permission-admin',
  )

  if (bindings.length === 0) {
    cleanupConflict('The GCP integration used by this legacy Watch is no longer connected')
  }
  const candidates: GcpProviderWiring[] = []

  for (const binding of bindings) {
    const token = await gcpToken(binding.serviceAccountEmail, teamId)
    const channels = await listAllGcpChannels(token, binding.projectId)
    const owned = channels.filter((channel) =>
      targetsManagedWebhook(channel.labels?.url, triggerId),
    )

    if (owned.length === 0) continue
    if (owned.length > 1)
      cleanupConflict('Multiple GCP notification channels target this legacy Watch')
    const policies = await listAllGcpAlertPolicies(token, binding.projectId)
    const linked = policies.filter(
      (policy) =>
        Array.isArray(policy.notificationChannels) &&
        policy.notificationChannels.includes(owned[0]!.name),
    )

    if (linked.length !== 1)
      cleanupConflict('Could not uniquely identify the GCP alert policy for this legacy Watch')
    candidates.push({
      provider: 'gcp',
      projectId: binding.projectId,
      serviceAccountEmail: binding.serviceAccountEmail,
      alertPolicyName: String(linked[0]!.name),
      notificationChannelName: String(owned[0]!.name),
    })
  }
  if (candidates.length > 1)
    cleanupConflict('This legacy Watch was found in more than one GCP integration')

  return candidates[0] ?? null
}

async function discoverLegacyBetterStack(
  teamId: ObjectId,
  triggerId: string,
): Promise<BetterStackProviderWiring | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { betterStackIntegrations: 1 } },
  )
  const bindings = (doc?.betterStackIntegrations ?? []).filter((item) =>
    Boolean(item.encryptedUptimeApiToken),
  )

  if (bindings.length === 0) {
    cleanupConflict('The Better Stack integration used by this legacy Watch is no longer connected')
  }
  const candidates: BetterStackProviderWiring[] = []

  for (const binding of bindings) {
    if (!binding.encryptedUptimeApiToken) continue
    const handle = { uptimeApiToken: decryptBetterStackToken(binding.encryptedUptimeApiToken) }
    const webhooks = await listBetterStackOutgoingWebhooks(handle)
    const owned = webhooks.filter((item) => targetsManagedWebhook(item.url, triggerId))

    if (owned.length === 0) continue
    if (owned.length > 1) cleanupConflict('Multiple Better Stack webhooks target this legacy Watch')
    candidates.push({
      provider: 'betterstack',
      integrationId: binding.id.toHexString(),
      outgoingWebhookId: owned[0]!.id,
      scope: 'account',
    })
  }
  if (candidates.length > 1)
    cleanupConflict('This legacy Watch was found in more than one Better Stack integration')

  return candidates[0] ?? null
}

/**
 * Older managed Watches predate receipts. New rows carry monitoringIdentity;
 * startup-migrated rows carry legacyMonitoringProvider. Runtime discovery
 * never derives provider ownership from editable message text.
 */
export async function discoverLegacyProviderWiring(
  trigger: AgentTrigger,
  triggerId: string,
): Promise<MonitoringProviderWiring | null> {
  const provider = likelyLegacyProvider(trigger)

  if (!provider) return null
  if (!trigger.teamId || !ObjectId.isValid(trigger.teamId)) {
    cleanupConflict('This legacy managed Watch has no valid team ownership')
  }
  const teamId = new ObjectId(trigger.teamId)
  const receipt =
    provider === 'grafana'
      ? await discoverLegacyGrafana(teamId, triggerId)
      : provider === 'gcp'
        ? await discoverLegacyGcp(teamId, triggerId)
        : provider === 'betterstack'
          ? await discoverLegacyBetterStack(teamId, triggerId)
          : null

  // Legacy Watches predate ownership receipts. If every connected provider
  // API was reached successfully but none still exposes a resource carrying
  // this trigger's webhook marker, another idempotent cleanup (or a duplicate
  // Watch sharing the same provider wiring) already completed the external
  // work. Treat that as success so the local trigger cannot become undeletable.
  // Missing integrations and unreachable APIs fail above and remain retryable.
  return receipt
}
