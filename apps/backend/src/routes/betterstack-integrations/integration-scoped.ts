import { ObjectId } from 'mongodb'

import { accessView, bindingAccessUpdateSchema, normalizeAccessInput } from '@/lib/byos/access'
import {
  verifyBetterStackTelemetryToken,
  verifyBetterStackUptimeToken,
} from '@/lib/byos/betterstack'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireBetterStackMemberAccess, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import {
  betterStackCredentials,
  betterStackError,
  encryptBetterStackTokenOrUnavailable,
  publicView,
  updateSchema,
} from '@/routes/betterstack-integrations/shared'

import type { BetterStackIntegrationVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerBetterStackIntegrationRoutes(
  integrationScoped: Hono<{ Variables: BetterStackIntegrationVariables }>,
) {
  integrationScoped.get('/', (c) => {
    return c.json(publicView(c.get('betterStackBinding')))
  })

  integrationScoped.patch(
    '/',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', updateSchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const integrationId = new ObjectId(c.get('betterStackIntegrationId'))
      const { label, uptimeApiToken, telemetryApiToken, dashboardTeamId, prometheusWebhookUrl } =
        c.req.valid('json')

      const nextHasUptime =
        uptimeApiToken === undefined
          ? Boolean(c.get('betterStackEncryptedUptimeApiToken'))
          : uptimeApiToken !== null
      const nextHasTelemetry =
        telemetryApiToken === undefined
          ? Boolean(c.get('betterStackEncryptedTelemetryApiToken'))
          : telemetryApiToken !== null

      if (!nextHasUptime && !nextHasTelemetry) {
        throw new AppError(
          400,
          'invalid_betterstack_credentials',
          'Provide at least one Better Stack API token',
        )
      }

      if (typeof uptimeApiToken === 'string') {
        await verifyBetterStackUptimeToken({ uptimeApiToken }).catch((err: unknown) => {
          throw betterStackError(err, 'Better Stack Uptime credentials could not be verified')
        })
      }
      if (typeof telemetryApiToken === 'string') {
        await verifyBetterStackTelemetryToken({ telemetryApiToken }).catch((err: unknown) => {
          throw betterStackError(err, 'Better Stack Telemetry credentials could not be verified')
        })
      }

      const now = new Date()
      const set: Record<string, unknown> = { updatedAt: now }
      const unset: Record<string, ''> = {}
      const match: Record<string, unknown> = { id: integrationId }

      if (label !== undefined) set['betterStackIntegrations.$.label'] = label
      if (typeof dashboardTeamId === 'string') {
        set['betterStackIntegrations.$.dashboardTeamId'] = dashboardTeamId
      } else if (dashboardTeamId === null) {
        unset['betterStackIntegrations.$.dashboardTeamId'] = ''
      }
      if (typeof prometheusWebhookUrl === 'string') {
        set['betterStackIntegrations.$.prometheusWebhookUrl'] = prometheusWebhookUrl
      } else if (prometheusWebhookUrl === null) {
        unset['betterStackIntegrations.$.prometheusWebhookUrl'] = ''
      }
      if (typeof uptimeApiToken === 'string') {
        set['betterStackIntegrations.$.encryptedUptimeApiToken'] =
          encryptBetterStackTokenOrUnavailable(uptimeApiToken)
      } else if (uptimeApiToken === null) {
        unset['betterStackIntegrations.$.encryptedUptimeApiToken'] = ''
        if (typeof telemetryApiToken !== 'string') {
          match.encryptedTelemetryApiToken = { $exists: true }
        }
      }
      if (typeof telemetryApiToken === 'string') {
        set['betterStackIntegrations.$.encryptedTelemetryApiToken'] =
          encryptBetterStackTokenOrUnavailable(telemetryApiToken)
      } else if (telemetryApiToken === null) {
        unset['betterStackIntegrations.$.encryptedTelemetryApiToken'] = ''
        if (typeof uptimeApiToken !== 'string') {
          match.encryptedUptimeApiToken = { $exists: true }
        }
      }

      const update: { $set: Record<string, unknown>; $unset?: Record<string, ''> } = { $set: set }

      if (Object.keys(unset).length > 0) update.$unset = unset

      const result = await teamByosBindings().updateOne(
        { _id: teamId, betterStackIntegrations: { $elemMatch: match } },
        update,
      )

      if (result.matchedCount === 0) {
        throw new AppError(
          400,
          'invalid_betterstack_credentials',
          'Provide at least one Better Stack API token',
        )
      }
      const doc = await teamByosBindings().findOne(
        { _id: teamId },
        { projection: { betterStackIntegrations: 1 } },
      )
      const updated = doc?.betterStackIntegrations?.find((item) => item.id.equals(integrationId))

      if (!updated) {
        throw new AppError(
          404,
          'betterstack_integration_not_bound',
          'Better Stack integration not found',
        )
      }

      return c.json(publicView(updated))
    },
  )

  integrationScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const integrationId = new ObjectId(c.get('betterStackIntegrationId'))
    const result = await teamByosBindings().updateOne(
      { _id: teamId, 'betterStackIntegrations.id': integrationId },
      {
        $pull: { betterStackIntegrations: { id: integrationId } },
        $set: { updatedAt: new Date() },
      },
    )

    if (result.matchedCount === 0) {
      throw new AppError(
        404,
        'betterstack_integration_not_bound',
        'Better Stack integration not found',
      )
    }

    return c.body(null, 204)
  })

  integrationScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) => {
    return c.json(accessView(c.get('betterStackAccess')))
  })

  integrationScoped.put(
    '/access',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', bindingAccessUpdateSchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const integrationId = new ObjectId(c.get('betterStackIntegrationId'))
      const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))

      await teamByosBindings().updateOne(
        { _id: teamId, 'betterStackIntegrations.id': integrationId },
        {
          $set: {
            'betterStackIntegrations.$.access': access,
            updatedAt: access.updatedAt,
          },
        },
      )

      return c.json(accessView(access))
    },
  )

  integrationScoped.get('/credentials', requireBetterStackMemberAccess(), (c) => {
    const tokens = betterStackCredentials(c)

    return c.json({
      id: c.get('betterStackIntegrationId'),
      integrationId: c.get('betterStackIntegrationId'),
      label: c.get('betterStackLabel'),
      uptimeApiToken: tokens.uptimeApiToken,
      telemetryApiToken: tokens.telemetryApiToken,
      prometheusWebhookUrl: c.get('betterStackBinding').prometheusWebhookUrl ?? null,
      authType: 'api_token',
    })
  })
}
