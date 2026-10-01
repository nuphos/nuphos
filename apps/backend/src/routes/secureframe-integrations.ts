import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { encryptSecureframeSecret } from '@/lib/byos/secrets'
import {
  credentialsFromBinding,
  listSecureframeTests,
  verifySecureframeCredentials,
  SecureframeApiError,
} from '@/lib/byos/secureframe'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import {
  requireSecureframeIntegration,
  requireSecureframeMemberAccess,
  requireTeamRole,
} from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { SecureframeIntegrationVariables, TeamAuthVariables } from '@/middleware/auth'
import type { SecureframeIntegrationBinding } from '@/models'

export const secureframeIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Secureframe binds with a static API key + secret pair (Settings → Company
// Settings → API keys → Create API Key). No OAuth.
const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    region: z.enum(['us', 'uk']).default('us'),
    apiKey: z.string().trim().min(1).max(200),
    apiSecret: z.string().trim().min(1).max(400),
  })
  .strict()

export function publicView(binding: SecureframeIntegrationBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    region: binding.region,
    createdAt: binding.createdAt,
  }
}

secureframeIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { secureframeIntegrations: 1 } },
  )

  return c.json({ integrations: (doc?.secureframeIntegrations ?? []).map(publicView) })
})

secureframeIntegrationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, region, apiKey, apiSecret } = c.req.valid('json')

    await verifySecureframeCredentials({ region, apiKey, apiSecret }).catch((err: unknown) => {
      if (err instanceof SecureframeApiError && (err.status === 401 || err.status === 403)) {
        throw new AppError(
          400,
          'invalid_secureframe_credentials',
          'The Secureframe API key or secret is invalid or has been revoked.',
        )
      }
      throw new AppError(
        502,
        'secureframe_api_unavailable',
        `Could not reach Secureframe API: ${(err as Error).message}`,
      )
    })

    const now = new Date()
    const binding: SecureframeIntegrationBinding = {
      id: new ObjectId(),
      label,
      region,
      apiKey,
      encryptedApiSecret: encryptSecureframeSecret(apiSecret),
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { secureframeIntegrations: binding },
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

const integrationScoped = new Hono<{ Variables: SecureframeIntegrationVariables }>()

integrationScoped.use('*', requireSecureframeIntegration())

integrationScoped.get('/', (c) => {
  return c.json({
    id: c.get('secureframeIntegrationId'),
    label: c.get('secureframeIntegrationLabel'),
    region: c.get('secureframeBinding').region,
  })
})

integrationScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const integrationId = new ObjectId(c.get('secureframeIntegrationId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { secureframeIntegrations: { id: integrationId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(
      404,
      'secureframe_integration_not_bound',
      'Secureframe integration not found',
    )
  }

  return c.body(null, 204)
})

const testsQuerySchema = z
  .object({
    // When 'true' (default), restrict to failing tests — the issues to resolve.
    failingOnly: z.enum(['true', 'false']).optional(),
    // Optional raw Lucene query override (e.g. "health_status:fail AND frameworks:soc2_alpha").
    q: z.string().trim().min(1).max(300).optional(),
  })
  .strict()

// Server-side proxy: the agent (and desktop) read tests via this route so the
// API secret never leaves the backend.
integrationScoped.get(
  '/tests',
  requireSecureframeMemberAccess(),
  zv('query', testsQuerySchema),
  async (c) => {
    const { failingOnly, q } = c.req.valid('query')
    const creds = credentialsFromBinding(c.get('secureframeBinding'))
    const tests = await listSecureframeTests(creds, {
      failingOnly: failingOnly !== 'false',
      query: q,
    }).catch((err: unknown) => {
      if (err instanceof SecureframeApiError && (err.status === 401 || err.status === 403)) {
        throw new AppError(
          400,
          'invalid_secureframe_credentials',
          'The stored Secureframe credentials are no longer valid. Re-bind the integration.',
        )
      }
      throw new AppError(502, 'secureframe_api_error', (err as Error).message)
    })

    return c.json({ tests })
  },
)

// No raw-credential endpoint: Secureframe is read-only and fully served by the
// server-side /tests proxy above, so the API secret never leaves the backend.

secureframeIntegrationsRoutes.route('/:integrationId', integrationScoped)
