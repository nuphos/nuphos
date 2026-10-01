import { z } from 'zod'

import {
  createUptimeKumaMonitor,
  deleteUptimeKumaMonitor,
  getUptimeKumaMonitor,
  listUptimeKumaMonitors,
  pauseUptimeKumaMonitor,
  resumeUptimeKumaMonitor,
  updateUptimeKumaMonitor,
} from '@/lib/byos/uptime-kuma'
import { zv } from '@/lib/validate'
import { requireUptimeKumaMemberAccess } from '@/middleware/auth'
import {
  handleFromBinding,
  monitorIdParam,
  uptimeKumaError,
} from '@/routes/uptime-kuma-instances/shared'

import type { UptimeKumaInstanceVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const monitorCreateSchema = z
  .object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
    acceptedStatusCodes: z.array(z.string()).optional(),
    accepted_statuscodes: z.array(z.string()).optional(),
  })
  .passthrough()

const monitorPatchSchema = z
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

export function registerUptimeKumaMonitorRoutes(
  instanceScoped: Hono<{ Variables: UptimeKumaInstanceVariables }>,
) {
  instanceScoped.get('/monitors', requireUptimeKumaMemberAccess(), async (c) => {
    const monitors = await listUptimeKumaMonitors(
      handleFromBinding(c.get('uptimeKumaBinding')),
    ).catch((err: unknown) => {
      throw uptimeKumaError(err, 'Could not list Uptime Kuma monitors')
    })

    return c.json({ monitors })
  })

  instanceScoped.post(
    '/monitors',
    requireUptimeKumaMemberAccess(),
    zv('json', monitorCreateSchema),
    async (c) => {
      const result = await createUptimeKumaMonitor(
        handleFromBinding(c.get('uptimeKumaBinding')),
        c.req.valid('json') as Record<string, unknown>,
      ).catch((err: unknown) => {
        throw uptimeKumaError(err, 'Could not create Uptime Kuma monitor')
      })

      return c.json(result, 201)
    },
  )

  instanceScoped.get('/monitors/:monitorId', requireUptimeKumaMemberAccess(), async (c) => {
    const monitor = await getUptimeKumaMonitor(
      handleFromBinding(c.get('uptimeKumaBinding')),
      monitorIdParam(c.req.param('monitorId')),
    ).catch((err: unknown) => {
      throw uptimeKumaError(err, 'Could not get Uptime Kuma monitor')
    })

    return c.json({ monitor })
  })

  instanceScoped.patch(
    '/monitors/:monitorId',
    requireUptimeKumaMemberAccess(),
    zv('json', monitorPatchSchema),
    async (c) => {
      const monitor = await updateUptimeKumaMonitor(
        handleFromBinding(c.get('uptimeKumaBinding')),
        monitorIdParam(c.req.param('monitorId')),
        c.req.valid('json') as Record<string, unknown>,
      ).catch((err: unknown) => {
        throw uptimeKumaError(err, 'Could not update Uptime Kuma monitor')
      })

      return c.json({ monitor })
    },
  )

  instanceScoped.post('/monitors/:monitorId/pause', requireUptimeKumaMemberAccess(), async (c) => {
    await pauseUptimeKumaMonitor(
      handleFromBinding(c.get('uptimeKumaBinding')),
      monitorIdParam(c.req.param('monitorId')),
    ).catch((err: unknown) => {
      throw uptimeKumaError(err, 'Could not pause Uptime Kuma monitor')
    })

    return c.body(null, 204)
  })

  instanceScoped.post('/monitors/:monitorId/resume', requireUptimeKumaMemberAccess(), async (c) => {
    await resumeUptimeKumaMonitor(
      handleFromBinding(c.get('uptimeKumaBinding')),
      monitorIdParam(c.req.param('monitorId')),
    ).catch((err: unknown) => {
      throw uptimeKumaError(err, 'Could not resume Uptime Kuma monitor')
    })

    return c.body(null, 204)
  })

  instanceScoped.delete('/monitors/:monitorId', requireUptimeKumaMemberAccess(), async (c) => {
    await deleteUptimeKumaMonitor(
      handleFromBinding(c.get('uptimeKumaBinding')),
      monitorIdParam(c.req.param('monitorId')),
      c.req.query('deleteChildren') === 'true',
    ).catch((err: unknown) => {
      throw uptimeKumaError(err, 'Could not delete Uptime Kuma monitor')
    })

    return c.body(null, 204)
  })
}
