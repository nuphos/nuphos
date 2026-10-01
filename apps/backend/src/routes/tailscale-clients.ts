import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { encryptTailscaleClientSecret } from '@/lib/byos/secrets'
import {
  tailscaleFederationAudience,
  TailscaleApiError,
  verifyTailscaleOAuthClient,
} from '@/lib/byos/tailscale'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTailscaleClient, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { registerTailscaleClientScopedRoutes } from '@/routes/tailscale-clients/client-scoped'
import { publicView } from '@/routes/tailscale-clients/shared'

import type { TailscaleClientVariables, TeamAuthVariables } from '@/middleware/auth'
import type { TailscaleOAuthClientBinding } from '@/models'

export { publicView } from '@/routes/tailscale-clients/shared'

export const tailscaleClientsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Either a stored client secret, or a federation trust the customer set up on
// their tailnet. Federated bindings leave Nuphos holding nothing.
const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    clientId: z.string().trim().min(1).max(256),
    clientSecret: z.string().trim().min(1).optional(),
    federated: z.boolean().optional(),
    audience: z.string().trim().min(1).max(512).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.clientSecret) !== Boolean(value.federated), {
    message: 'Provide either clientSecret or federated: true, not both',
  })

tailscaleClientsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { tailscaleClients: 1 } },
  )

  return c.json({ clients: (doc?.tailscaleClients ?? []).map(publicView) })
})

tailscaleClientsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, clientId, clientSecret, federated, audience } = c.req.valid('json')
    const federation = federated
      ? { audience: audience || tailscaleFederationAudience(clientId) }
      : undefined

    await verifyTailscaleOAuthClient(
      federation
        ? { clientId, audience: federation.audience, teamId: teamId.toHexString() }
        : { clientId, clientSecret: clientSecret! },
    ).catch((err: unknown) => {
      if (err instanceof TailscaleApiError && (err.status === 400 || err.status === 401)) {
        throw new AppError(
          400,
          'invalid_tailscale_oauth_client',
          'The Tailscale OAuth client ID or secret is invalid.',
        )
      }
      throw new AppError(
        502,
        'tailscale_api_unavailable',
        `Could not reach Tailscale API: ${(err as Error).message}`,
      )
    })

    const existing = await teamByosBindings().findOne(
      { _id: teamId, 'tailscaleClients.clientId': clientId },
      { projection: { _id: 1 } },
    )

    if (existing) {
      throw new AppError(
        409,
        'tailscale_client_already_bound',
        'This Tailscale OAuth client is already bound',
      )
    }

    const now = new Date()
    const binding: TailscaleOAuthClientBinding = {
      id: new ObjectId(),
      label,
      clientId,
      ...(federation
        ? { federation }
        : { encryptedClientSecret: encryptTailscaleClientSecret(clientSecret!) }),
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { tailscaleClients: binding },
        $set: { updatedAt: now },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          cloudflareAccounts: [],
          linodeAccounts: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

    return c.json(publicView(binding), 201)
  },
)

const clientScoped = new Hono<{ Variables: TailscaleClientVariables }>()

clientScoped.use('*', requireTailscaleClient())

registerTailscaleClientScopedRoutes(clientScoped)

tailscaleClientsRoutes.route('/:clientId', clientScoped)
