import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { createDefaultAccess } from '@/lib/byos/access'
import {
  verifyBetterStackTelemetryToken,
  verifyBetterStackUptimeToken,
} from '@/lib/byos/betterstack'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireBetterStackIntegration, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { registerBetterStackIntegrationRoutes } from '@/routes/betterstack-integrations/integration-scoped'
import { registerBetterStackMonitoringRoutes } from '@/routes/betterstack-integrations/monitoring'
import {
  betterStackError,
  bindSchema,
  encryptBetterStackTokenOrUnavailable,
  publicView,
} from '@/routes/betterstack-integrations/shared'

import type { BetterStackIntegrationVariables, TeamAuthVariables } from '@/middleware/auth'
import type { BetterStackIntegrationBinding } from '@/models'

export { publicView } from '@/routes/betterstack-integrations/shared'

export const betterStackIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

betterStackIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { betterStackIntegrations: 1 } },
  )

  return c.json({
    integrations: (doc?.betterStackIntegrations ?? []).map(publicView),
  })
})

betterStackIntegrationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, uptimeApiToken, telemetryApiToken, dashboardTeamId, prometheusWebhookUrl } =
      c.req.valid('json')

    if (uptimeApiToken) {
      await verifyBetterStackUptimeToken({ uptimeApiToken }).catch((err: unknown) => {
        throw betterStackError(err, 'Better Stack Uptime credentials could not be verified')
      })
    }
    if (telemetryApiToken) {
      await verifyBetterStackTelemetryToken({ telemetryApiToken }).catch((err: unknown) => {
        throw betterStackError(err, 'Better Stack Telemetry credentials could not be verified')
      })
    }

    const now = new Date()
    const binding: BetterStackIntegrationBinding = {
      id: new ObjectId(),
      label,
      ...(dashboardTeamId ? { dashboardTeamId } : {}),
      ...(prometheusWebhookUrl ? { prometheusWebhookUrl } : {}),
      ...(uptimeApiToken
        ? { encryptedUptimeApiToken: encryptBetterStackTokenOrUnavailable(uptimeApiToken) }
        : {}),
      ...(telemetryApiToken
        ? { encryptedTelemetryApiToken: encryptBetterStackTokenOrUnavailable(telemetryApiToken) }
        : {}),
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { betterStackIntegrations: binding },
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

const integrationScoped = new Hono<{ Variables: BetterStackIntegrationVariables }>()

integrationScoped.use('*', requireBetterStackIntegration())

registerBetterStackIntegrationRoutes(integrationScoped)
registerBetterStackMonitoringRoutes(integrationScoped)

betterStackIntegrationsRoutes.route('/:integrationId', integrationScoped)
