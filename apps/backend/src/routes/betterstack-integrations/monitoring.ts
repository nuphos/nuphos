import {
  createBetterStackMonitor,
  deleteBetterStackHeartbeat,
  deleteBetterStackMonitor,
  listBetterStackCollectors,
  listBetterStackDashboards,
  listBetterStackHeartbeats,
  listBetterStackIncidents,
  listBetterStackMonitors,
  listBetterStackSourceMetrics,
  listBetterStackSources,
  updateBetterStackMonitor,
} from '@/lib/byos/betterstack'
import { zv } from '@/lib/validate'
import { requireBetterStackMemberAccess } from '@/middleware/auth'
import {
  betterStackError,
  betterStackTelemetryToken,
  betterStackUptimeToken,
  createMonitorSchema,
  monitorInputSchema,
  requireTelemetryToken,
  requireUptimeToken,
} from '@/routes/betterstack-integrations/shared'

import type { BetterStackMonitorInput } from '@/lib/byos/betterstack'
import type { BetterStackIntegrationVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerBetterStackMonitoringRoutes(
  integrationScoped: Hono<{ Variables: BetterStackIntegrationVariables }>,
) {
  integrationScoped.get('/uptime/monitors', requireBetterStackMemberAccess(), async (c) => {
    const uptimeApiToken = betterStackUptimeToken(c)
    const monitors = await listBetterStackMonitors({
      uptimeApiToken: requireUptimeToken(uptimeApiToken),
    }).catch((err: unknown) => {
      throw betterStackError(err, 'Could not list Better Stack monitors')
    })

    return c.json({ monitors })
  })

  integrationScoped.post(
    '/uptime/monitors',
    requireBetterStackMemberAccess(),
    zv('json', createMonitorSchema),
    async (c) => {
      const uptimeApiToken = betterStackUptimeToken(c)
      const monitor = await createBetterStackMonitor(
        { uptimeApiToken: requireUptimeToken(uptimeApiToken) },
        c.req.valid('json') as BetterStackMonitorInput,
      ).catch((err: unknown) => {
        throw betterStackError(err, 'Could not create Better Stack monitor')
      })

      return c.json({ monitor }, 201)
    },
  )

  integrationScoped.patch(
    '/uptime/monitors/:monitorId',
    requireBetterStackMemberAccess(),
    zv('json', monitorInputSchema),
    async (c) => {
      const uptimeApiToken = betterStackUptimeToken(c)
      const monitor = await updateBetterStackMonitor(
        { uptimeApiToken: requireUptimeToken(uptimeApiToken) },
        c.req.param('monitorId'),
        c.req.valid('json') as BetterStackMonitorInput,
      ).catch((err: unknown) => {
        throw betterStackError(err, 'Could not update Better Stack monitor')
      })

      return c.json({ monitor })
    },
  )

  integrationScoped.delete(
    '/uptime/monitors/:monitorId',
    requireBetterStackMemberAccess(),
    async (c) => {
      const uptimeApiToken = betterStackUptimeToken(c)

      await deleteBetterStackMonitor(
        { uptimeApiToken: requireUptimeToken(uptimeApiToken) },
        c.req.param('monitorId'),
      ).catch((err: unknown) => {
        throw betterStackError(err, 'Could not delete Better Stack monitor')
      })

      return c.body(null, 204)
    },
  )

  integrationScoped.delete(
    '/uptime/heartbeats/:heartbeatId',
    requireBetterStackMemberAccess(),
    async (c) => {
      const uptimeApiToken = betterStackUptimeToken(c)

      await deleteBetterStackHeartbeat(
        { uptimeApiToken: requireUptimeToken(uptimeApiToken) },
        c.req.param('heartbeatId'),
      ).catch((err: unknown) => {
        throw betterStackError(err, 'Could not delete Better Stack heartbeat')
      })

      return c.body(null, 204)
    },
  )

  integrationScoped.get('/uptime/heartbeats', requireBetterStackMemberAccess(), async (c) => {
    const uptimeApiToken = betterStackUptimeToken(c)
    const heartbeats = await listBetterStackHeartbeats({
      uptimeApiToken: requireUptimeToken(uptimeApiToken),
    }).catch((err: unknown) => {
      throw betterStackError(err, 'Could not list Better Stack heartbeats')
    })

    return c.json({ heartbeats })
  })

  integrationScoped.get('/uptime/incidents', requireBetterStackMemberAccess(), async (c) => {
    const uptimeApiToken = betterStackUptimeToken(c)
    const incidents = await listBetterStackIncidents({
      uptimeApiToken: requireUptimeToken(uptimeApiToken),
    }).catch((err: unknown) => {
      throw betterStackError(err, 'Could not list Better Stack incidents')
    })

    return c.json({ incidents })
  })

  integrationScoped.get('/telemetry/dashboards', requireBetterStackMemberAccess(), async (c) => {
    const telemetryApiToken = betterStackTelemetryToken(c)
    const dashboards = await listBetterStackDashboards({
      telemetryApiToken: requireTelemetryToken(telemetryApiToken),
    }).catch((err: unknown) => {
      throw betterStackError(err, 'Could not list Better Stack dashboards')
    })

    return c.json({ dashboards })
  })

  integrationScoped.get('/telemetry/sources', requireBetterStackMemberAccess(), async (c) => {
    const telemetryApiToken = betterStackTelemetryToken(c)
    const sources = await listBetterStackSources({
      telemetryApiToken: requireTelemetryToken(telemetryApiToken),
    }).catch((err: unknown) => {
      throw betterStackError(err, 'Could not list Better Stack sources')
    })

    return c.json({ sources })
  })

  integrationScoped.get('/telemetry/collectors', requireBetterStackMemberAccess(), async (c) => {
    const telemetryApiToken = betterStackTelemetryToken(c)
    const collectors = await listBetterStackCollectors({
      telemetryApiToken: requireTelemetryToken(telemetryApiToken),
    }).catch((err: unknown) => {
      throw betterStackError(err, 'Could not list Better Stack collectors')
    })

    return c.json({ collectors })
  })

  integrationScoped.get(
    '/telemetry/sources/:sourceId/metrics',
    requireBetterStackMemberAccess(),
    async (c) => {
      const telemetryApiToken = betterStackTelemetryToken(c)
      const metrics = await listBetterStackSourceMetrics(
        { telemetryApiToken: requireTelemetryToken(telemetryApiToken) },
        c.req.param('sourceId'),
      ).catch((err: unknown) => {
        throw betterStackError(err, 'Could not list Better Stack source metrics')
      })

      return c.json({ metrics })
    },
  )
}
