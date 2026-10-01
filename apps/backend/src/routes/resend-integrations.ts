import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { ResendApiError, verifyResendApiKey } from '@/lib/byos/resend'
import { encryptResendSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireResendIntegration, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { ResendIntegrationVariables, TeamAuthVariables } from '@/middleware/auth'
import type { ResendIntegrationBinding } from '@/models'

export const resendIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Resend binds with a static API key (Dashboard → API Keys → Create API Key,
// "re_…"). No OAuth. The key's permission level — full access vs sending-only —
// is probed on bind and recorded, since it decides what the agent can do.
const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    apiKey: z.string().trim().min(1).max(300),
  })
  .strict()

export function publicView(binding: ResendIntegrationBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    permission: binding.permission,
    domains: binding.domains,
    createdAt: binding.createdAt,
  }
}

resendIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { resendIntegrations: 1 } },
  )

  return c.json({ integrations: (doc?.resendIntegrations ?? []).map(publicView) })
})

resendIntegrationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, apiKey } = c.req.valid('json')

    // verifyResendApiKey already absorbs 401 restricted_api_key as a valid
    // sending-access key, so anything still throwing here is a real failure.
    // Resend answers a bad key with 403 invalid_api_key, not 401.
    const info = await verifyResendApiKey(apiKey).catch((err: unknown) => {
      if (err instanceof ResendApiError && (err.status === 403 || err.status === 401)) {
        throw new AppError(
          400,
          'invalid_resend_api_key',
          'The Resend API key is invalid or has been revoked.',
        )
      }
      const message = err instanceof Error ? err.message : 'unknown error'

      throw new AppError(
        502,
        'resend_api_unavailable',
        `Could not reach the Resend API: ${message}`,
      )
    })

    const now = new Date()
    const binding: ResendIntegrationBinding = {
      id: new ObjectId(),
      label,
      permission: info.permission,
      domains: info.domains,
      encryptedApiKey: encryptResendSecret(apiKey),
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { resendIntegrations: binding },
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

const integrationScoped = new Hono<{ Variables: ResendIntegrationVariables }>()

integrationScoped.use('*', requireResendIntegration())

integrationScoped.get('/', (c) => {
  return c.json(publicView(c.get('resendBinding')))
})

integrationScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const integrationId = new ObjectId(c.get('resendIntegrationId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { resendIntegrations: { id: integrationId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(404, 'resend_integration_not_bound', 'Resend integration not found')
  }

  return c.body(null, 204)
})

// NOTE: there is deliberately NO team-scoped /credentials handout here, unlike
// notion-integrations. Every other provider exposes one and lets the sandbox
// fall back to it outside a session, which would let any sandbox holding a
// NUPHOS_TOKEN fetch this key regardless of the conversation's selection —
// defeating the per-session send gate entirely. The Resend key is handed out
// only by the session-scoped route in agent-sessions.ts, which additionally
// enforces requireSelectedResendAgentCredential().

resendIntegrationsRoutes.route('/:integrationId', integrationScoped)
