import { z } from 'zod'

import { discoverPosthogAccount, PosthogApiError } from '@/lib/byos/posthog'
import { parseScope, permissionsForScopes, scopeDiff } from '@/lib/byos/posthog-scopes'
import { PosthogReconnectRequired, withPosthogAccessToken } from '@/lib/byos/posthog-tokens'
import { AppError } from '@/lib/errors'

import type { PosthogDiscovery } from '@/lib/byos/posthog'
import type { PosthogIntegrationBinding, PosthogProjectRef } from '@/models'
import type { ObjectId } from 'mongodb'

export const MAX_POSTHOG_PROJECTS = 50

export const projectIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(MAX_POSTHOG_PROJECTS)
  .transform((ids) => [...new Set(ids)])

export function posthogPublicView(binding: PosthogIntegrationBinding) {
  const granted = parseScope(binding.scope ?? '')
  const requested = binding.requestedScopes ?? granted

  return {
    id: binding.id.toHexString(),
    label: binding.label,
    region: binding.region,
    apiBaseUrl: binding.apiBaseUrl,
    userEmail: binding.userEmail ?? null,
    projects: binding.projects ?? [],
    requestedScopes: requested,
    grantedScopes: granted,
    permissions: permissionsForScopes(granted),
    ...scopeDiff(requested, granted),
    status: needsReconnect(binding) ? 'reconnect_required' : 'connected',
    createdAt: binding.createdAt,
  }
}

// Bindings from before OAuth carry no tokens and can only be reconnected.
export function needsReconnect(binding: PosthogIntegrationBinding): boolean {
  return Boolean(binding.reconnectRequired) || !binding.encryptedAccessToken
}

export function posthogReconnectError(): AppError {
  return new AppError(
    409,
    'posthog_reconnect_required',
    'PostHog authorization expired or was revoked. Reconnect PostHog to continue.',
  )
}

export function mapPosthogError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof PosthogReconnectRequired) return posthogReconnectError()
  if (err instanceof PosthogApiError) {
    if (err.status === 403) {
      return new AppError(
        400,
        'posthog_permission_denied',
        `PostHog denied the request: ${err.message}`,
      )
    }

    return new AppError(502, 'posthog_api_unavailable', err.message)
  }
  const detail = err instanceof Error ? err.message : 'unknown error'

  return new AppError(502, 'posthog_api_unavailable', `Could not reach PostHog: ${detail}`)
}

export async function discoverWithBinding(
  teamId: ObjectId,
  binding: PosthogIntegrationBinding,
): Promise<PosthogDiscovery> {
  return await withPosthogAccessToken(teamId, binding, (accessToken) =>
    discoverPosthogAccount({ apiBaseUrl: binding.apiBaseUrl, accessToken }, binding.scopedTeams),
  ).catch((err: unknown) => {
    throw mapPosthogError(err)
  })
}

export function pickProjects(available: PosthogProjectRef[], ids: number[]): PosthogProjectRef[] {
  const byId = new Map(available.map((project) => [project.id, project]))
  const picked = ids.flatMap((id) => byId.get(id) ?? [])

  if (picked.length !== ids.length) {
    const missing = ids.filter((id) => !byId.has(id))

    throw new AppError(
      400,
      'posthog_projects_unavailable',
      `This PostHog grant cannot reach project ${missing.join(', ')}.`,
    )
  }

  return picked
}
