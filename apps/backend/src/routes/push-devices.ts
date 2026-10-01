import { Hono } from 'hono'
import { z } from 'zod'

import { pushDeviceStore } from '@/lib/push/devices'
import { zv } from '@/lib/validate'
import { requireAuth } from '@/middleware/auth'

import type { PushDeviceStore } from '@/lib/push/devices'
import type { AuthVariables } from '@/middleware/auth'

const apnsToken = z.string().regex(/^[0-9a-f]{64,200}$/i)

const registrationSchema = z.object({
  token: apnsToken,
  deviceId: z.string().trim().min(1).max(128),
  platform: z.literal('ios').default('ios'),
  environment: z.enum(['sandbox', 'production']),
  bundleId: z.string().trim().max(200).optional(),
})

export function createPushDeviceRoutes(store: PushDeviceStore) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.put('/devices', zv('json', registrationSchema), async (c) => {
    const body = c.req.valid('json')

    await store.register(c.get('userId'), { ...body, token: body.token.toLowerCase() })

    return c.json({ ok: true })
  })

  routes.delete('/devices/:token', zv('param', z.object({ token: apnsToken })), async (c) => {
    await store.unregister(c.get('userId'), c.req.valid('param').token.toLowerCase())

    return c.json({ ok: true })
  })

  return routes
}

export const pushRoutes = new Hono<{ Variables: AuthVariables }>()

pushRoutes.use('*', requireAuth)
pushRoutes.route('/', createPushDeviceRoutes(pushDeviceStore))
