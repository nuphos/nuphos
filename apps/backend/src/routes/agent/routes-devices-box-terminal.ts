import { Hono } from 'hono'
import { z } from 'zod'

import { deviceAccessDeps, requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { setBoxUseTerminal } from '@/lib/agent/devices/manage-access'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { readTeamIdCandidate } from './team-scope'

import type { DeviceAccessDeps } from '@/lib/agent/devices/box-access'
import type { AuthVariables } from '@/middleware/auth'

// Whether those who only use a Box may open a terminal on it. A terminal reads the Box's files,
// its agents' sign-in among them, so only its owner turns this on; it is off until they do.

const deviceParam = z.object({ deviceId: z.string().trim().min(1).max(128) })
const terminalSchema = z.object({ useTerminal: z.boolean() })

export type BoxTerminalRouteDependencies = {
  access: DeviceAccessDeps
  setUseTerminal: typeof setBoxUseTerminal
}

const defaultDependencies: BoxTerminalRouteDependencies = {
  access: deviceAccessDeps,
  setUseTerminal: setBoxUseTerminal,
}

export function createBoxTerminalRoutes(deps: BoxTerminalRouteDependencies = defaultDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.put(
    '/devices/:deviceId/box/terminal-access',
    zv('param', deviceParam),
    zv('json', terminalSchema),
    async (c) => {
      const device = await requireDeviceAccess(
        c.get('userId'),
        readTeamIdCandidate(c),
        c.req.valid('param').deviceId,
        'owner',
        deps.access,
      )
      const { useTerminal } = c.req.valid('json')

      if (!device.box || !(await deps.setUseTerminal(device.userId, device.deviceId, useTerminal)))
        throw new AppError(404, 'device_not_found', 'Device is not available')

      return c.json({ useTerminal })
    },
  )

  return routes
}
