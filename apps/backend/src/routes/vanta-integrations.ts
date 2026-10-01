import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { encryptVantaSecret } from '@/lib/byos/secrets'
import {
  getVantaAccessToken,
  listVantaTests,
  verifyVantaClientCredentials,
  invalidateVantaAccessToken,
  VantaApiError,
} from '@/lib/byos/vanta'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import {
  requireVantaIntegration,
  requireVantaMemberAccess,
  requireTeamRole,
} from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { VantaIntegrationVariables, TeamAuthVariables } from '@/middleware/auth'
import type { VantaIntegrationBinding } from '@/models'

export const vantaIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// client_credentials bind: the team pastes its own "Manage Vanta" app's
// client_id (vci_…) and client_secret (vcs_…). Works today without Vanta
// partner approval. The OAuth ("click to authorize") branch is bound via
// /vanta-app/setup once VANTA_OAUTH_* is configured.
const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    clientId: z.string().trim().min(1).max(200),
    clientSecret: z.string().trim().min(1).max(400),
  })
  .strict()

export function publicView(binding: VantaIntegrationBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    orgDisplayName: binding.orgDisplayName,
    authType: binding.authType,
    createdAt: binding.createdAt,
  }
}

vantaIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { vantaIntegrations: 1 } },
  )

  return c.json({ integrations: (doc?.vantaIntegrations ?? []).map(publicView) })
})

vantaIntegrationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, clientId, clientSecret } = c.req.valid('json')

    await verifyVantaClientCredentials(clientId, clientSecret).catch((err: unknown) => {
      if (err instanceof VantaApiError && (err.status === 400 || err.status === 401)) {
        throw new AppError(
          400,
          'invalid_vanta_credentials',
          'The Vanta client ID or secret is invalid or has been revoked.',
        )
      }
      throw new AppError(
        502,
        'vanta_api_unavailable',
        `Could not reach Vanta API: ${(err as Error).message}`,
      )
    })

    const now = new Date()
    const binding: VantaIntegrationBinding = {
      id: new ObjectId(),
      label,
      orgDisplayName: null,
      authType: 'client_credentials',
      clientCredentials: {
        clientId,
        encryptedClientSecret: encryptVantaSecret(clientSecret),
      },
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { vantaIntegrations: binding },
        $set: { updatedAt: now },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          cloudflareAccounts: [],
          tailscaleClients: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

    return c.json(publicView(binding), 201)
  },
)

const integrationScoped = new Hono<{ Variables: VantaIntegrationVariables }>()

integrationScoped.use('*', requireVantaIntegration())

integrationScoped.get('/', (c) => {
  return c.json({
    id: c.get('vantaIntegrationId'),
    label: c.get('vantaIntegrationLabel'),
    orgDisplayName: c.get('vantaBinding').orgDisplayName,
    authType: c.get('vantaBinding').authType,
  })
})

integrationScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const integrationId = new ObjectId(c.get('vantaIntegrationId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { vantaIntegrations: { id: integrationId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(404, 'vanta_integration_not_bound', 'Vanta integration not found')
  }
  invalidateVantaAccessToken(teamId, integrationId)

  return c.body(null, 204)
})

const testsQuerySchema = z
  .object({
    // Defaults to the failing/needs-work tests — the compliance issues to solve.
    status: z.string().trim().min(1).max(40).optional(),
    // When 'true', restrict to infrastructure-facing categories.
    infraOnly: z.enum(['true', 'false']).optional(),
  })
  .strict()

// Server-side proxy: the agent (and desktop) read failing tests via this route
// so the raw Vanta token never leaves the backend. The agent's Vanta skill
// prefers this over the raw /credentials token.
integrationScoped.get(
  '/tests',
  requireVantaMemberAccess(),
  zv('query', testsQuerySchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { status, infraOnly } = c.req.valid('query')
    const token = await getVantaAccessToken(teamId, c.get('vantaBinding')).catch((err: unknown) => {
      if (err instanceof VantaApiError && (err.status === 400 || err.status === 401)) {
        throw new AppError(
          400,
          'invalid_vanta_credentials',
          'The stored Vanta credentials are no longer valid. Re-bind the integration.',
        )
      }
      throw new AppError(502, 'vanta_api_unavailable', (err as Error).message)
    })
    const tests = await listVantaTests(token, {
      statusFilter: status ?? 'NEEDS_ATTENTION',
      infraOnly: infraOnly === 'true',
    }).catch((err: unknown) => {
      throw new AppError(502, 'vanta_api_error', (err as Error).message)
    })

    return c.json({ tests })
  },
)

// No raw-credential endpoint: Vanta is read-only and fully served by the
// server-side /tests proxy above, so the access token never leaves the backend.

vantaIntegrationsRoutes.route('/:integrationId', integrationScoped)
