import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { createDefaultAccess } from '@/lib/byos/access'
import { findPosthogIntegration } from '@/lib/byos/account'
import { discoverPosthogAccount, POSTHOG_REGION_HOSTS } from '@/lib/byos/posthog'
import {
  exchangePosthogCode,
  POSTHOG_CALLBACK_PATH,
  posthogClientMetadata,
  posthogMetadataPath,
  posthogPublicBase,
} from '@/lib/byos/posthog-oauth'
import { revokeReplacedGrant } from '@/lib/byos/posthog-revoke'
import { decodeScopeSet, POSTHOG_SCOPE_CEILING } from '@/lib/byos/posthog-scopes'
import { invalidatePosthogAccessToken } from '@/lib/byos/posthog-tokens'
import { decryptPosthogSecret, encryptPosthogSecret } from '@/lib/byos/secrets'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { emptyTeamByosBindings, posthogPendingOAuth, teamByosBindings } from '@/models'
import { MAX_POSTHOG_PROJECTS } from '@/routes/posthog-integrations/shared'

import type { PosthogDiscovery } from '@/lib/byos/posthog'
import type { PosthogTokens } from '@/lib/byos/posthog-oauth'
import type { PosthogIntegrationBinding, PosthogPendingOAuth } from '@/models'
import type { Context } from 'hono'

export const posthogAppRoutes = new Hono()

const DESKTOP_CALLBACK = 'nuphos://posthog-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

function serveMetadata(c: Context, path: string, scopes: readonly string[] | null) {
  const base = posthogPublicBase()

  if (!base || !scopes) throw new AppError(404, 'not_found', 'Unknown PostHog client')
  c.header('Cache-Control', 'public, max-age=300')

  return c.json(
    posthogClientMetadata(
      { clientId: `${base}${path}`, redirectUri: `${base}${POSTHOG_CALLBACK_PATH}` },
      scopes,
    ),
  )
}

posthogAppRoutes.get('/client-metadata/s/:file{[0-9a-f]{1,32}\\.json}', (c) => {
  const scopes = decodeScopeSet(c.req.param('file').slice(0, -'.json'.length))

  return serveMetadata(c, scopes ? posthogMetadataPath(scopes) : '', scopes)
})

// Clients issued before per-set clients declared the whole ceiling; they stay
// servable so their grants keep refreshing.
posthogAppRoutes.get('/client-metadata.json', (c) =>
  serveMetadata(c, '/posthog-app/client-metadata.json', POSTHOG_SCOPE_CEILING),
)
posthogAppRoutes.get('/client-metadata/:version{[a-f0-9]{12}\\.json}', (c) =>
  serveMetadata(c, `/posthog-app/client-metadata/${c.req.param('version')}`, POSTHOG_SCOPE_CEILING),
)

posthogAppRoutes.get('/callback', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) throw new AppError(400, 'invalid_state', 'Missing state from PostHog redirect')

  const pending = await posthogPendingOAuth().findOneAndDelete({ _id: state })

  if (errorParam) {
    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }
  if (!pending || pending.expiresAt.getTime() < Date.now()) {
    return desktopCallback(c, {
      state,
      error: pending ? 'expired' : 'unknown_state',
      error_description: 'The PostHog authorization expired or was already used. Try again.',
    })
  }
  if (!code) throw new AppError(400, 'invalid_code', 'Missing code from PostHog redirect')

  const apiBaseUrl = POSTHOG_REGION_HOSTS[pending.region]
  let tokens: PosthogTokens
  let discovery: PosthogDiscovery

  try {
    tokens = await exchangePosthogCode({
      region: pending.region,
      client: { clientId: pending.clientId, redirectUri: pending.redirectUri },
      code,
      codeVerifier: decryptPosthogSecret(pending.encryptedCodeVerifier),
    })
    discovery = await discoverPosthogAccount(
      { apiBaseUrl, accessToken: tokens.accessToken },
      tokens.scopedTeams,
    )
  } catch (e) {
    return desktopCallback(c, {
      state,
      error: 'exchange_failed',
      error_description: e instanceof Error ? e.message : 'PostHog authorization failed',
    })
  }

  const existing = await findExisting(pending, apiBaseUrl, discovery.user)
  const binding = buildBinding(pending, existing, apiBaseUrl, tokens, discovery)

  await persistBinding(pending, binding, existing)
  if (existing) await revokeReplacedGrant(existing, binding)

  return desktopCallback(c, {
    state,
    binding_id: binding.id.toHexString(),
    team_id: pending.teamId.toHexString(),
    account_name: discovery.user.email ?? discovery.user.name ?? binding.label,
  })
})

function buildBinding(
  pending: PosthogPendingOAuth,
  existing: PosthogIntegrationBinding | null,
  apiBaseUrl: string,
  tokens: PosthogTokens,
  discovery: PosthogDiscovery,
): PosthogIntegrationBinding {
  const reachable = new Set(discovery.projects.map((project) => project.id))
  const keptProjects = (existing?.projects ?? []).filter((project) => reachable.has(project.id))

  return {
    id: existing?.id ?? new ObjectId(),
    label: existing?.label ?? pending.label,
    region: pending.region,
    apiBaseUrl,
    clientId: pending.clientId,
    userEmail: discovery.user.email,
    userUuid: discovery.user.uuid,
    projects: keptProjects.length
      ? keptProjects
      : discovery.projects.slice(0, MAX_POSTHOG_PROJECTS),
    scopedTeams: tokens.scopedTeams,
    requestedScopes: pending.requestedScopes,
    scope: tokens.scope || pending.requestedScopes.join(' '),
    encryptedAccessToken: encryptPosthogSecret(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken ? encryptPosthogSecret(tokens.refreshToken) : null,
    accessTokenExpiresAt: tokens.expiresAt,
    createdAt: existing?.createdAt ?? new Date(),
    ...(existing?.access ? { access: existing.access } : {}),
  }
}

async function persistBinding(
  pending: PosthogPendingOAuth,
  binding: PosthogIntegrationBinding,
  existing: PosthogIntegrationBinding | null,
): Promise<void> {
  if (existing) {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      { $set: { 'posthogIntegrations.$[el]': binding, updatedAt: new Date() } },
      { arrayFilters: [{ 'el.id': existing.id }] },
    )
    invalidatePosthogAccessToken(pending.teamId, existing.id)

    return
  }

  const { posthogIntegrations: _pushed, ...insertDefaults } = emptyTeamByosBindings()

  await teamByosBindings().updateOne(
    { _id: pending.teamId },
    {
      $push: {
        posthogIntegrations: { ...binding, access: createDefaultAccess(pending.requesterUserId) },
      },
      $set: { updatedAt: new Date() },
      $setOnInsert: insertDefaults,
    },
    { upsert: true },
  )
}

// A reconnect targets its binding; a fresh connect of an already-bound PostHog
// user refreshes that binding instead of adding a duplicate.
async function findExisting(
  pending: PosthogPendingOAuth,
  apiBaseUrl: string,
  user: PosthogDiscovery['user'],
): Promise<PosthogIntegrationBinding | null> {
  if (pending.integrationId)
    return await findPosthogIntegration(pending.teamId, pending.integrationId)
  if (!user.uuid && !user.email) return null
  const doc = await teamByosBindings().findOne(
    { _id: pending.teamId },
    { projection: { posthogIntegrations: 1 } },
  )
  const sameUser = (binding: PosthogIntegrationBinding) =>
    user.uuid ? binding.userUuid === user.uuid : binding.userEmail === user.email

  return (
    (doc?.posthogIntegrations ?? []).find(
      (binding) => binding.apiBaseUrl === apiBaseUrl && sameUser(binding),
    ) ?? null
  )
}
