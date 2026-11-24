import { Hono } from 'hono'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import type { AgentDeviceRouteDependencies } from './routes-devices'
import type { AuthVariables } from '@/middleware/auth'

const params = z.object({
  deviceId: z.string().trim().min(1).max(128),
  provider: z.enum(['claude-code', 'codex']),
})

export function createDeviceSignInRoutes(
  deps: Pick<AgentDeviceRouteDependencies, 'forgetOwnSignIn'>,
) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  // Its owner signed a default agent in with its own CLI on this computer: it runs as them now,
  // so whoever signed it in through Nuphos, and a sign-in that ended, no longer apply.
  routes.delete('/devices/:deviceId/agents/:provider/sign-in', zv('param', params), async (c) => {
    const { deviceId, provider } = c.req.valid('param')

    if (!(await deps.forgetOwnSignIn(c.get('userId'), deviceId, provider)))
      throw new AppError(404, 'device_not_found', 'Device is not registered')

    return c.body(null, 204)
  })

  return routes
}
