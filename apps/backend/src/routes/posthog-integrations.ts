import crypto from 'node:crypto'

import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { findPosthogIntegration } from '@/lib/byos/account'
import {
  buildPosthogAuthorizeUrl,
  createPkcePair,
  posthogOAuthClient,
} from '@/lib/byos/posthog-oauth'
import {
  DEFAULT_POSTHOG_PERMISSIONS,
  parseScope,
  permissionsForScopes,
  POSTHOG_FIXED_SCOPES,
  POSTHOG_PRESETS,
  POSTHOG_RESOURCES,
  PosthogPermissionError,
  scopesForPermissions,
} from '@/lib/byos/posthog-scopes'
import { encryptPosthogSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { posthogPendingOAuth, teamByosBindings } from '@/models'
import { posthogIntegrationScoped } from '@/routes/posthog-integrations/scoped'
import { posthogPublicView } from '@/routes/posthog-integrations/shared'

import type { PosthogPermissions } from '@/lib/byos/posthog-scopes'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { PosthogIntegrationBinding, PosthogRegion } from '@/models'

export { posthogPublicView } from '@/routes/posthog-integrations/shared'

export const posthogIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

const startSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    region: z.enum(['us', 'eu']).optional(),
    integrationId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .optional(),
    permissions: z.record(z.enum(['none', 'read', 'write'])).optional(),
  })
  .strict()

type StartInput = z.infer<typeof startSchema>

function requestedScopes(permissions: PosthogPermissions): string[] {
  try {
    return scopesForPermissions(permissions)
  } catch (err) {
    if (err instanceof PosthogPermissionError) {
      throw new AppError(400, 'invalid_posthog_permissions', err.message)
    }
    throw err
  }
}

// A reconnect or permission edit keeps the binding's label and region; a new
// connection must name both.
function grantTarget(
  input: StartInput,
  existing: PosthogIntegrationBinding | null,
): { label: string; region: PosthogRegion; scopes: string[] } {
  if (existing) {
    return {
      label: existing.label,
      region: existing.region,
      scopes: requestedScopes(
        input.permissions ?? permissionsForScopes(parseScope(existing.scope ?? '')),
      ),
    }
  }
  if (!input.label || !input.region) {
    throw new AppError(400, 'invalid_request', 'label and region are required for a new connection')
  }

  return {
    label: input.label,
    region: input.region,
    scopes: requestedScopes(input.permissions ?? DEFAULT_POSTHOG_PERMISSIONS),
  }
}

posthogIntegrationsRoutes.get('/scope-catalog', (c) =>
  c.json({
    fixedScopes: POSTHOG_FIXED_SCOPES,
    resources: POSTHOG_RESOURCES,
    presets: POSTHOG_PRESETS,
  }),
)

posthogIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { posthogIntegrations: 1 } },
  )

  return c.json({ integrations: (doc?.posthogIntegrations ?? []).map(posthogPublicView) })
})

posthogIntegrationsRoutes.post(
  '/start-oauth',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', startSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const input = c.req.valid('json')
    const reconnectId = input.integrationId ? new ObjectId(input.integrationId) : undefined
    const existing = reconnectId ? await findPosthogIntegration(teamId, reconnectId) : null

    if (reconnectId && !existing) {
      throw new AppError(404, 'posthog_integration_not_bound', 'PostHog integration not found')
    }
    const { label, region, scopes } = grantTarget(input, existing)
    const client = posthogOAuthClient(scopes)

    if (!client) {
      throw new AppError(
        503,
        'posthog_oauth_unavailable',
        'PostHog OAuth needs a public HTTPS backend URL (NUPHOS_PUBLIC_BACKEND_URL); locally, run the dev launcher with its Cloudflare tunnel.',
      )
    }
    const state = crypto.randomBytes(24).toString('hex')
    const pkce = createPkcePair()
    const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

    await posthogPendingOAuth().insertOne({
      _id: state,
      teamId,
      requesterUserId: c.get('userId'),
      label,
      region,
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      encryptedCodeVerifier: encryptPosthogSecret(pkce.verifier),
      requestedScopes: scopes,
      ...(reconnectId ? { integrationId: reconnectId } : {}),
      expiresAt,
    })

    return c.json({
      authorizeUrl: buildPosthogAuthorizeUrl({
        region,
        client,
        state,
        codeChallenge: pkce.challenge,
        scopes,
      }),
      state,
      expiresAt: expiresAt.toISOString(),
    })
  },
)

posthogIntegrationsRoutes.delete(
  '/start-oauth/:state',
  requireTeamRole('ADMINISTRATOR'),
  async (c) => {
    const state = c.req.param('state')

    if (!/^[a-f0-9]{1,128}$/i.test(state)) {
      throw new AppError(400, 'invalid_state', 'Invalid state token')
    }
    await posthogPendingOAuth().deleteOne({
      _id: state,
      teamId: parseObjectId(c.get('teamId'), 'teamId'),
    })

    return c.body(null, 204)
  },
)

posthogIntegrationsRoutes.route('/:integrationId', posthogIntegrationScoped)
