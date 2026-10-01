import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { verifyUptimeKumaCredentials } from '@/lib/byos/uptime-kuma'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole, requireUptimeKumaInstance } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { registerUptimeKumaInstanceRoutes } from '@/routes/uptime-kuma-instances/instance-scoped'
import { registerUptimeKumaMonitorRoutes } from '@/routes/uptime-kuma-instances/monitors'
import {
  baseUrlSchema,
  encryptUptimeKumaSecretOrUnavailable,
  publicView,
  uptimeKumaError,
  uptimeKumaInstancesView,
} from '@/routes/uptime-kuma-instances/shared'

import type { TeamAuthVariables, UptimeKumaInstanceVariables } from '@/middleware/auth'
import type { UptimeKumaInstanceBinding } from '@/models'

export { uptimeKumaInstancesView } from '@/routes/uptime-kuma-instances/shared'

export const uptimeKumaInstancesRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    baseUrl: baseUrlSchema,
    username: z.string().trim().min(1).max(255).optional(),
    password: z.string().min(1).optional(),
    authToken: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => value.authToken || (value.username && value.password), {
    message: 'Provide either an Uptime Kuma auth token or username/password',
  })

uptimeKumaInstancesRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { uptimeKumaInstances: 1 } },
  )

  return c.json({
    instances: uptimeKumaInstancesView(doc?.uptimeKumaInstances, c.get('userId')),
  })
})

uptimeKumaInstancesRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, baseUrl, username, password, authToken } = c.req.valid('json')

    await verifyUptimeKumaCredentials({
      baseUrl,
      ...(authToken ? { authToken } : { username, password }),
    }).catch((err: unknown) => {
      throw uptimeKumaError(err, 'Uptime Kuma credentials could not be verified')
    })

    const now = new Date()
    const binding: UptimeKumaInstanceBinding = {
      id: new ObjectId(),
      label,
      baseUrl,
      ...(authToken
        ? { encryptedAuthToken: encryptUptimeKumaSecretOrUnavailable(authToken) }
        : {
            username,
            encryptedPassword: encryptUptimeKumaSecretOrUnavailable(password!),
          }),
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { uptimeKumaInstances: binding },
        $set: { updatedAt: now },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          cloudflareAccounts: [],
          linodeAccounts: [],
          hetznerAccounts: [],
          betterStackIntegrations: [],
          tailscaleClients: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

    return c.json(publicView(binding), 201)
  },
)

const instanceScoped = new Hono<{ Variables: UptimeKumaInstanceVariables }>()

instanceScoped.use('*', requireUptimeKumaInstance())

registerUptimeKumaInstanceRoutes(instanceScoped)
registerUptimeKumaMonitorRoutes(instanceScoped)

uptimeKumaInstancesRoutes.route('/:instanceId', instanceScoped)
