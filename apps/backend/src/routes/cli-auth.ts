import { createHash } from 'node:crypto'

import { Hono } from 'hono'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { trustedAvatarURL } from '@/lib/identity/avatar-url'
import {
  listCliTokens,
  mintCliToken,
  revokeCliToken,
  updateAgentProfile,
} from '@/lib/identity/cli-tokens'
import {
  decideDeviceLogin,
  findPendingDeviceLogin,
  pollDeviceLogin,
  startDeviceLogin,
} from '@/lib/identity/device-login'
import { redisEnabled, withRedis } from '@/lib/redis'
import { clientIp } from '@/lib/request-origin'
import { zv } from '@/lib/validate'
import { requireAuth } from '@/middleware/auth'
import { avatarBodyLimit } from '@/routes/auth'

import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

const VERIFICATION_URI = 'https://nuphos.ai/device'

const agentFields = {
  name: z.string().trim().min(1).max(64),
  teamId: z.string().regex(/^[a-f\d]{24}$/),
  avatarUrl: z
    .string()
    .optional()
    .refine((v) => v === undefined || trustedAvatarURL(v) !== undefined, 'Unsupported avatar URL'),
}

const decisionSchema = z.discriminatedUnion('decision', [
  z.object({ userCode: z.string(), decision: z.literal('deny') }),
  z.object({ userCode: z.string(), decision: z.literal('personal') }),
  z.object({ userCode: z.string(), decision: z.literal('agent'), ...agentFields }),
])

type Quota = (key: string, limit: number, windowSec: number) => Promise<boolean>

/** Fixed-window counter in Redis. Without Redis configured (local dev) it never limits. */
const redisQuota: Quota = async (key, limit, windowSec) => {
  const count = await withRedis(async (client) => {
    const n = await client.incr(key)

    if (n === 1) await client.expire(key, windowSec)

    return n
  })

  return count === null ? !redisEnabled() : count <= limit
}

function ipOf(c: Context): string | undefined {
  return clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For'))
}

function hashed(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

/**
 * `/auth/device*`: device sign-in (see `lib/identity/device-login.ts`).
 * `/auth/cli-tokens*`: the signed-in user's CLI and agent tokens. Which token
 * kinds may call what is decided in `requireAuth` (`cliTokenDenied`).
 */
export function createCliAuthRoutes(quota: Quota = redisQuota) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.post('/device', async (c) => {
    const ip = ipOf(c)

    if (!(await quota(`device-login:ip:${hashed(ip ?? 'unknown')}`, 20, 3600))) {
      throw new AppError(429, 'rate_limited', 'Too many sign-in requests; try again later')
    }
    const body = (await c.req.json().catch(() => ({}))) as { clientName?: unknown }
    const started = await startDeviceLogin({ clientName: body.clientName, requesterIp: ip })

    return c.json({ ...started, verificationUri: VERIFICATION_URI })
  })

  routes.post('/device/token', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { deviceCode?: unknown }
    const result = await pollDeviceLogin(body.deviceCode)

    switch (result.status) {
      case 'pending':
        throw new AppError(409, 'authorization_pending', 'Waiting for approval on nuphos.ai')
      case 'slow_down':
        throw new AppError(429, 'slow_down', 'Polling too fast')
      case 'denied':
        throw new AppError(403, 'access_denied', 'The sign-in was denied')
      case 'expired':
        throw new AppError(400, 'expired_token', 'This sign-in code has expired; start again')
      case 'approved':
        return c.json({ token: result.token, user: result.user, cliToken: result.cliToken })
    }
  })

  // The approval page: what is asking, then the decision. A session only (`cliTokenDenied`).
  routes.get('/device/approve', requireAuth, async (c) => {
    await guessQuota(c, quota)
    const pending = await findPendingDeviceLogin(c.req.query('userCode'))

    if (!pending) throw new AppError(404, 'invalid_user_code', 'This code is wrong or has expired')

    return c.json(pending)
  })

  routes.post('/device/approve', requireAuth, zv('json', decisionSchema), async (c) => {
    await guessQuota(c, quota)
    const { userCode, ...decision } = c.req.valid('json')

    await decideDeviceLogin(userCode, c.get('user'), decision)

    return c.json({ ok: true })
  })

  routes.get('/cli-tokens', requireAuth, async (c) =>
    c.json({ tokens: await listCliTokens(c.get('userId')) }),
  )

  routes.post('/cli-tokens', requireAuth, zv('json', z.object(agentFields)), async (c) => {
    const input = c.req.valid('json')

    if (!(await getTeamMembership(c.get('userId'), input.teamId))) {
      throw new AppError(403, 'forbidden', 'You are not a member of this team')
    }
    const { token, principal } = await mintCliToken({
      kind: 'agent',
      userId: c.get('userId'),
      teamId: input.teamId,
      name: input.name,
      ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
      createdIp: ipOf(c),
    })

    return c.json({ token, cliToken: principal }, 201)
  })

  routes.delete('/cli-tokens/:id', requireAuth, async (c) => {
    if (!(await revokeCliToken(c.get('userId'), c.req.param('id')))) {
      throw new AppError(404, 'not_found', 'No such token')
    }

    return c.json({ ok: true })
  })

  // The calling agent token's own name and avatar. No id in the path: the
  // token can only ever reach itself (`updateAgentProfile` filters by owner too).
  routes.patch(
    '/agent-profile',
    requireAuth,
    zv('json', z.object({ name: agentFields.name })),
    async (c) =>
      c.json({
        cliToken: await updateAgentProfile(c.get('userId'), ownAgentTokenId(c), {
          name: c.req.valid('json').name,
        }),
      }),
  )

  routes.put('/agent-profile/avatar', requireAuth, avatarBodyLimit, async (c) =>
    c.json({
      cliToken: await updateAgentProfile(c.get('userId'), ownAgentTokenId(c), {
        avatar: new Uint8Array(await c.req.arrayBuffer()),
      }),
    }),
  )

  // The owner setting one of their agent tokens' avatar (nuphos.ai/settings/tokens).
  // Agent tokens are refused here by `cliTokenDenied`.
  routes.put('/cli-tokens/:id/avatar', requireAuth, avatarBodyLimit, async (c) =>
    c.json({
      cliToken: await updateAgentProfile(c.get('userId'), c.req.param('id'), {
        avatar: new Uint8Array(await c.req.arrayBuffer()),
      }),
    }),
  )

  routes.delete('/cli-tokens/:id/avatar', requireAuth, async (c) =>
    c.json({
      cliToken: await updateAgentProfile(c.get('userId'), c.req.param('id'), { avatar: null }),
    }),
  )

  return routes
}

function ownAgentTokenId(c: Context<{ Variables: AuthVariables }>): string {
  const cliToken = c.get('cliToken')

  if (cliToken?.kind !== 'agent') {
    throw new AppError(403, 'forbidden', 'Only an agent token has an agent profile')
  }

  return cliToken.id
}

/** Codes are guessable only by trying: cap tries per approving user. */
async function guessQuota(c: Context<{ Variables: AuthVariables }>, quota: Quota) {
  if (!(await quota(`device-login:approve:${c.get('userId')}`, 30, 600))) {
    throw new AppError(429, 'rate_limited', 'Too many attempts; wait a few minutes')
  }
}

export const cliAuthRoutes = createCliAuthRoutes()
