import { Hono } from 'hono'
import { z } from 'zod'

import { getReadableConversation } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { pushDeviceStore } from '@/lib/push/devices'
import { liveActivityStore } from '@/lib/push/live-activities'
import { zv } from '@/lib/validate'
import { requireAuth } from '@/middleware/auth'

import type { PushDeviceStore } from '@/lib/push/devices'
import type { LiveActivityStore } from '@/lib/push/live-activities'
import type { AuthVariables } from '@/middleware/auth'

const apnsToken = z.string().regex(/^[0-9a-f]{64,200}$/i)

const fcmToken = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_:.-]+$/)
const deviceId = z.string().trim().min(1).max(128)
const registrationSchema = z.preprocess(
  (value) => (value && typeof value === 'object' ? { platform: 'ios', ...value } : value),
  z.discriminatedUnion('platform', [
    z.object({
      token: apnsToken,
      deviceId,
      platform: z.literal('ios'),
      environment: z.enum(['sandbox', 'production']),
      bundleId: z.string().trim().max(200).optional(),
    }),
    z.object({
      token: fcmToken,
      deviceId,
      platform: z.literal('android'),
      environment: z.literal('production'),
      bundleId: z.literal('ai.nuphos.android'),
      projectId: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/),
    }),
  ]),
)

export function createPushDeviceRoutes(store: PushDeviceStore) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.put('/devices', zv('json', registrationSchema), async (c) => {
    const body = c.req.valid('json')

    await store.register(c.get('userId'), {
      ...body,
      token: body.platform === 'ios' ? body.token.toLowerCase() : body.token,
    })

    return c.json({ ok: true })
  })

  routes.delete(
    '/devices/:token',
    zv('param', z.object({ token: fcmToken })),
    zv('query', z.object({ platform: z.enum(['ios', 'android']).default('ios') })),
    async (c) => {
      const token = c.req.valid('param').token
      const platform = c.req.valid('query').platform

      if (platform === 'ios' && !apnsToken.safeParse(token).success)
        return c.json({ error: 'Invalid token' }, 400)
      await store.unregister(c.get('userId'), platform === 'ios' ? token.toLowerCase() : token)

      return c.json({ ok: true })
    },
  )

  return routes
}

const liveActivitySchema = z.object({
  token: apnsToken,
  teamId: z.string().trim().min(1).max(64),
  sessionId: z.string().trim().min(1).max(128),
  environment: z.enum(['sandbox', 'production']),
})

export type CanReadConversation = (
  userId: string,
  teamId: string,
  sessionId: string,
) => Promise<boolean>

/** A Live Activity's push token, so the end of the turn reaches the Lock Screen. */
export function createLiveActivityRoutes(store: LiveActivityStore, canRead: CanReadConversation) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.put('/live-activities', zv('json', liveActivitySchema), async (c) => {
    const { token, teamId, sessionId, environment } = c.req.valid('json')
    const userId = c.get('userId')

    if (!(await canRead(userId, teamId, sessionId)))
      throw new AppError(404, 'not_found', 'Conversation not found')
    await store.register({ token: token.toLowerCase(), userId, sessionId, environment })

    return c.json({ ok: true })
  })

  return routes
}

async function canReadConversation(userId: string, teamId: string, sessionId: string) {
  if (!(await getTeamMembership(userId, teamId))) return false

  return Boolean(await getReadableConversation(sessionId, userId, teamId))
}

export const pushRoutes = new Hono<{ Variables: AuthVariables }>()

pushRoutes.use('*', requireAuth)
pushRoutes.route('/', createPushDeviceRoutes(pushDeviceStore))
pushRoutes.route('/', createLiveActivityRoutes(liveActivityStore, canReadConversation))
