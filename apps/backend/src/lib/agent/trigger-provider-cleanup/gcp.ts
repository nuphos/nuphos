import { impersonateSa } from '@/lib/byos/gcp'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import { cleanupConflict, sameJson, targetsManagedWebhook } from './shared'

import type { GcpProviderWiring } from '../trigger-provider-wiring'
import type { JsonObject } from './shared'
import type { ObjectId } from 'mongodb'

export async function gcpToken(serviceAccountEmail: string, teamId: ObjectId): Promise<string> {
  const auth = await impersonateSa(serviceAccountEmail, teamId.toHexString())
  const token = await auth.getAccessToken()

  if (!token.token)
    throw new AppError(502, 'provider_cleanup_failed', 'Could not mint a GCP access token')

  return token.token
}

export async function gcpRequest<T>(
  token: string,
  resource: string,
  init: RequestInit = {},
  allowNotFound = false,
): Promise<T | null> {
  const headers = new Headers(init.headers)

  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const url = resource.startsWith('https://')
    ? resource
    : `https://monitoring.googleapis.com/v3/${resource.replace(/^\//, '')}`
  let response: Response

  try {
    response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) })
  } catch (err) {
    throw new AppError(
      502,
      'provider_cleanup_unreachable',
      `GCP Monitoring cleanup could not reach the API: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (allowNotFound && response.status === 404) return null
  if (!response.ok) {
    throw new AppError(
      502,
      'provider_cleanup_failed',
      `GCP Monitoring cleanup failed at ${init.method ?? 'GET'} ${resource} (HTTP ${String(response.status)})`,
    )
  }
  if (response.status === 204) return null
  const text = await response.text()

  return text ? (JSON.parse(text) as T) : null
}

export async function listAllGcpAlertPolicies(
  token: string,
  projectId: string,
): Promise<JsonObject[]> {
  const policies: JsonObject[] = []
  let pageToken: string | undefined

  do {
    const query = new URLSearchParams({ pageSize: '1000' })

    if (pageToken) query.set('pageToken', pageToken)
    const page = await gcpRequest<JsonObject>(
      token,
      `projects/${encodeURIComponent(projectId)}/alertPolicies?${String(query)}`,
    )

    policies.push(...(Array.isArray(page?.alertPolicies) ? page.alertPolicies : []))
    pageToken = typeof page?.nextPageToken === 'string' ? page.nextPageToken : undefined
  } while (pageToken)

  return policies
}

export async function cleanupGcp(
  teamId: ObjectId,
  triggerId: string,
  receipt: GcpProviderWiring,
): Promise<void> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { gcpServiceAccounts: 1 } },
  )
  const binding = (doc?.gcpServiceAccounts ?? []).find(
    (item) =>
      item.projectId === receipt.projectId &&
      item.serviceAccountEmail === receipt.serviceAccountEmail &&
      item.purpose !== 'permission-admin',
  )

  if (!binding) cleanupConflict('The GCP integration used by this Watch is no longer connected')
  const projectPrefix = `projects/${receipt.projectId}/`

  if (
    !receipt.alertPolicyName.startsWith(`${projectPrefix}alertPolicies/`) ||
    !receipt.notificationChannelName.startsWith(`${projectPrefix}notificationChannels/`)
  ) {
    cleanupConflict('The GCP ownership receipt does not belong to the connected project')
  }

  const token = await gcpToken(receipt.serviceAccountEmail, teamId)
  const channel = await gcpRequest<JsonObject>(token, receipt.notificationChannelName, {}, true)

  if (channel) {
    const url = typeof channel.labels?.url === 'string' ? channel.labels.url : null

    if (channel.type !== 'webhook_tokenauth' || !targetsManagedWebhook(url, triggerId)) {
      cleanupConflict('The GCP notification channel no longer belongs to this Watch')
    }
  }

  const policy = await gcpRequest<JsonObject>(token, receipt.alertPolicyName, {}, true)

  if (policy) {
    const channels = Array.isArray(policy.notificationChannels) ? policy.notificationChannels : []

    if (channels.includes(receipt.notificationChannelName)) {
      const nextChannels = channels.filter(
        (name: unknown) => name !== receipt.notificationChannelName,
      )
      const preflight = await gcpRequest<JsonObject>(token, receipt.alertPolicyName, {}, true)

      if (!preflight || !sameJson(preflight.notificationChannels ?? [], channels)) {
        cleanupConflict(
          'The GCP alert policy changed while cleanup was preparing; retry after reviewing it',
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
  }

  const policies = await listAllGcpAlertPolicies(token, receipt.projectId)
  const remainingReferences = policies.filter(
    (item) =>
      Array.isArray(item.notificationChannels) &&
      item.notificationChannels.includes(receipt.notificationChannelName),
  )

  if (remainingReferences.length > 0) {
    cleanupConflict('The GCP notification channel is still referenced by an alert policy')
  }
  if (channel) {
    await gcpRequest(token, receipt.notificationChannelName, { method: 'DELETE' }, true)
  }
  const channelAfter = await gcpRequest(token, receipt.notificationChannelName, {}, true)

  if (channelAfter) {
    throw new AppError(
      502,
      'provider_cleanup_verification_failed',
      'GCP notification channel still exists after deletion',
    )
  }
}
