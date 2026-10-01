import { Hono } from 'hono'
import { z } from 'zod'

import { canUseAllowList } from '@/lib/byos/access'
import { decryptUptimeKumaSecret } from '@/lib/byos/secrets'
import {
  createUptimeKumaMonitor,
  deleteUptimeKumaMonitor,
  getUptimeKumaMonitor,
  listUptimeKumaMonitors,
  pauseUptimeKumaMonitor,
  resumeUptimeKumaMonitor,
  updateUptimeKumaMonitor,
  UptimeKumaApiError,
} from '@/lib/byos/uptime-kuma'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireUptimeKumaInstance, requireUptimeKumaMemberAccess } from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { UptimeKumaAuthHandle } from '@/lib/byos/uptime-kuma'
import type { UptimeKumaInstanceVariables } from '@/middleware/auth'
import type { AgentUptimeKumaVars } from '@/routes/agent-sessions/shared'
import type { MiddlewareHandler } from 'hono'

const uptimeKumaMonitorCreateSchema = z
  .object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
    acceptedStatusCodes: z.array(z.string()).optional(),
    accepted_statuscodes: z.array(z.string()).optional(),
  })
  .passthrough()

const uptimeKumaMonitorPatchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    type: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
    acceptedStatusCodes: z.array(z.string()).optional(),
    accepted_statuscodes: z.array(z.string()).optional(),
  })
  .passthrough()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one monitor setting to update',
  })

function uptimeKumaMonitorIdParam(raw: string): number {
  const id = Number(raw)

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError(400, 'invalid_monitor_id', 'monitorId must be a positive integer')
  }

  return id
}

function uptimeKumaAgentHandle(
  binding: UptimeKumaInstanceVariables['uptimeKumaBinding'],
): UptimeKumaAuthHandle {
  return {
    baseUrl: binding.baseUrl,
    ...(binding.encryptedAuthToken
      ? { authToken: decryptUptimeKumaSecret(binding.encryptedAuthToken) }
      : {}),
    ...(binding.username ? { username: binding.username } : {}),
    ...(binding.encryptedPassword
      ? { password: decryptUptimeKumaSecret(binding.encryptedPassword) }
      : {}),
  }
}

function uptimeKumaAgentError(err: unknown, fallback: string): AppError {
  if (err instanceof UptimeKumaApiError) {
    const code =
      err.status === 401 || err.status === 403
        ? 'invalid_uptime_kuma_credentials'
        : 'uptime_kuma_api_error'

    return new AppError(err.status === 401 || err.status === 403 ? 400 : 502, code, err.message)
  }

  return new AppError(502, 'uptime_kuma_api_error', err instanceof Error ? err.message : fallback)
}

export const uptimeKumaScoped = new Hono<{ Variables: AgentUptimeKumaVars }>()

uptimeKumaScoped.use('*', requireUptimeKumaInstance())
uptimeKumaScoped.use('*', requireUptimeKumaMemberAccess())
uptimeKumaScoped.use('*', requireSelectedUptimeKumaAgentCredential())

uptimeKumaScoped.get('/monitors', async (c) => {
  const monitors = await listUptimeKumaMonitors(
    uptimeKumaAgentHandle(c.get('uptimeKumaBinding')),
  ).catch((err: unknown) => {
    throw uptimeKumaAgentError(err, 'Could not list Uptime Kuma monitors')
  })

  return c.json({ monitors })
})

uptimeKumaScoped.post('/monitors', zv('json', uptimeKumaMonitorCreateSchema), async (c) => {
  const result = await createUptimeKumaMonitor(
    uptimeKumaAgentHandle(c.get('uptimeKumaBinding')),
    c.req.valid('json') as Record<string, unknown>,
  ).catch((err: unknown) => {
    throw uptimeKumaAgentError(err, 'Could not create Uptime Kuma monitor')
  })

  return c.json(result, 201)
})

uptimeKumaScoped.get('/monitors/:monitorId', async (c) => {
  const monitor = await getUptimeKumaMonitor(
    uptimeKumaAgentHandle(c.get('uptimeKumaBinding')),
    uptimeKumaMonitorIdParam(c.req.param('monitorId')),
  ).catch((err: unknown) => {
    throw uptimeKumaAgentError(err, 'Could not get Uptime Kuma monitor')
  })

  return c.json({ monitor })
})

uptimeKumaScoped.patch(
  '/monitors/:monitorId',
  zv('json', uptimeKumaMonitorPatchSchema),
  async (c) => {
    const monitor = await updateUptimeKumaMonitor(
      uptimeKumaAgentHandle(c.get('uptimeKumaBinding')),
      uptimeKumaMonitorIdParam(c.req.param('monitorId')),
      c.req.valid('json') as Record<string, unknown>,
    ).catch((err: unknown) => {
      throw uptimeKumaAgentError(err, 'Could not update Uptime Kuma monitor')
    })

    return c.json({ monitor })
  },
)

uptimeKumaScoped.post('/monitors/:monitorId/pause', async (c) => {
  await pauseUptimeKumaMonitor(
    uptimeKumaAgentHandle(c.get('uptimeKumaBinding')),
    uptimeKumaMonitorIdParam(c.req.param('monitorId')),
  ).catch((err: unknown) => {
    throw uptimeKumaAgentError(err, 'Could not pause Uptime Kuma monitor')
  })

  return c.body(null, 204)
})

uptimeKumaScoped.post('/monitors/:monitorId/resume', async (c) => {
  await resumeUptimeKumaMonitor(
    uptimeKumaAgentHandle(c.get('uptimeKumaBinding')),
    uptimeKumaMonitorIdParam(c.req.param('monitorId')),
  ).catch((err: unknown) => {
    throw uptimeKumaAgentError(err, 'Could not resume Uptime Kuma monitor')
  })

  return c.body(null, 204)
})

uptimeKumaScoped.delete('/monitors/:monitorId', async (c) => {
  await deleteUptimeKumaMonitor(
    uptimeKumaAgentHandle(c.get('uptimeKumaBinding')),
    uptimeKumaMonitorIdParam(c.req.param('monitorId')),
    c.req.query('deleteChildren') === 'true',
  ).catch((err: unknown) => {
    throw uptimeKumaAgentError(err, 'Could not delete Uptime Kuma monitor')
  })

  return c.body(null, 204)
})

function requireSelectedUptimeKumaAgentCredential(): MiddlewareHandler<{
  Variables: AgentUptimeKumaVars
}> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedInstanceIds = credentialAccess.uptimeKumaInstanceIds

    if (selectedInstanceIds.length === 0) {
      throw new AppError(
        403,
        'uptime_kuma_instance_agent_access_denied',
        'This agent session has no selected Uptime Kuma instances',
      )
    }

    const instanceId = c.get('uptimeKumaInstanceId')

    if (!selectedInstanceIds.includes(instanceId)) {
      throw new AppError(
        403,
        'uptime_kuma_instance_agent_access_denied',
        'This Uptime Kuma instance is not enabled for this agent session',
      )
    }
    if (!canUseAllowList(c.get('uptimeKumaAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'uptime_kuma_instance_agent_access_denied',
        'This Uptime Kuma instance is not enabled for this agent session',
      )
    }
    await next()
  }
}
