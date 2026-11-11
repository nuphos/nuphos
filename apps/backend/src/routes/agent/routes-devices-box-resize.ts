import { Hono } from 'hono'
import { z } from 'zod'

import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { MAX_BOX_DISK_GIB } from '@/lib/agent/devices/box-instabox-resize'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { deviceView } from './routes-devices-box'
import { readTeamIdCandidate } from './team-scope'

import type { AgentDeviceRouteDependencies } from './routes-devices'
import type { AuthVariables } from '@/middleware/auth'

// A Box's size: read it, and give it another size or a bigger disk.

const deviceParam = z.object({ deviceId: z.string().trim().min(1).max(128) })
const boxResizeSchema = z
  .object({
    /** One of the sizes its account offers. */
    vcpus: z.number().int().min(1).max(1024).optional(),
    /** The `/data` disk in GB; it only grows. */
    diskGiB: z.number().int().min(1).max(MAX_BOX_DISK_GIB).optional(),
  })
  .refine((body) => body.vcpus !== undefined || body.diskGiB !== undefined, {
    message: 'Give vcpus, diskGiB or both',
  })

export function createAgentDeviceBoxResizeRoutes(deps: AgentDeviceRouteDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  const provider = () => {
    if (!deps.box)
      throw new AppError(503, 'box_unavailable', 'Boxes are not enabled on this deployment')

    return deps.box
  }

  // Its size and disk now, and the sizes its account offers.
  routes.get('/devices/:deviceId/box/size', zv('param', deviceParam), async (c) => {
    const target = await requireDeviceAccess(
      c.get('userId'),
      readTeamIdCandidate(c),
      c.req.valid('param').deviceId,
      'manage',
      deps.access,
    )

    return c.json(await provider().size(target.userId, target.deviceId))
  })

  // It restarts a running Box, so it runs in the background; the view says it is resizing.
  routes.post(
    '/devices/:deviceId/box/resize',
    zv('param', deviceParam),
    zv('json', boxResizeSchema),
    async (c) => {
      const target = await requireDeviceAccess(
        c.get('userId'),
        readTeamIdCandidate(c),
        c.req.valid('param').deviceId,
        'manage',
        deps.access,
      )
      const device = await provider().resize(target.userId, target.deviceId, c.req.valid('json'))

      const view = await deviceView(deps, device, 'manage')

      if (!view) throw new AppError(404, 'not_found', 'This Box no longer exists')

      return c.json(view, 202)
    },
  )

  return routes
}
