import { Hono } from 'hono'
import { z } from 'zod'

import { getReadableConversation } from '@/lib/agent/db'
import { liveAttachment } from '@/lib/agent/db/shared'
import { readRuntimeStates } from '@/lib/claude-code-preview/runtime-state-store'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { pushDeviceStore } from '@/lib/push/devices'
import { liveActivityDeps, registerLiveActivityToken } from '@/lib/push/live-activities'
import { zv } from '@/lib/validate'
import { requireAuth } from '@/middleware/auth'

import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'
import type { PushDeviceStore } from '@/lib/push/devices'
import type { LiveActivityRow, LiveActivityToken } from '@/lib/push/live-activities'
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
      liveActivityStartToken: apnsToken.optional(),
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
      ...(body.platform === 'ios'
        ? {
            token: body.token.toLowerCase(),
            ...(body.liveActivityStartToken
              ? { liveActivityStartToken: body.liveActivityStartToken.toLowerCase() }
              : {}),
          }
        : {}),
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
  deviceId: deviceId.optional(),
})

/** The conversation, for its title on the card's row and its runtime's current
 *  state; null when the user cannot read it. */
export type ReadConversation = (
  userId: string,
  teamId: string,
  sessionId: string,
) => Promise<{ title?: string; runtimeState?: SessionExecutionState | null } | null>

/** Puts a conversation on the phone's Live Activity, so its turns reach the Lock Screen. */
export function createLiveActivityRoutes(
  register: (
    sessionId: string,
    token: LiveActivityToken,
    row: LiveActivityRow,
    state: SessionExecutionState | null,
  ) => Promise<void>,
  readConversation: ReadConversation,
) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.put('/live-activities', zv('json', liveActivitySchema), async (c) => {
    const { token, teamId, sessionId, environment, deviceId } = c.req.valid('json')
    const userId = c.get('userId')
    const conversation = await readConversation(userId, teamId, sessionId)

    if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
    await register(
      sessionId,
      { token: token.toLowerCase(), userId, environment, ...(deviceId ? { deviceId } : {}) },
      // Older conversations may have no title; their row still shows.
      { teamId, title: conversation.title ?? '' },
      conversation.runtimeState ?? null,
    )

    return c.json({ ok: true })
  })

  return routes
}

async function readConversation(userId: string, teamId: string, sessionId: string) {
  if (!(await getTeamMembership(userId, teamId))) return null
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) return null
  const openabSessionId = liveAttachment(conversation)?.openabSessionId
  const [runtimeState] = await readRuntimeStates(teamId, [openabSessionId])

  return { title: conversation.title, runtimeState }
}

export const pushRoutes = new Hono<{ Variables: AuthVariables }>()

pushRoutes.use('*', requireAuth)
pushRoutes.route('/', createPushDeviceRoutes(pushDeviceStore))
pushRoutes.route(
  '/',
  createLiveActivityRoutes(
    (sessionId, token, row, state) =>
      registerLiveActivityToken(liveActivityDeps, sessionId, token, row, state),
    readConversation,
  ),
)
