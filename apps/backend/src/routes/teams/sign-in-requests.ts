import { z } from 'zod'

import { nudge } from '@/lib/agent/sign-in-request'
import { settleSignInRequests } from '@/lib/agent/sign-in-settle'
import { zv } from '@/lib/validate'

import { requireLoginRole } from './runtime-login'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const body = z.object({ sessionId: z.string().min(1).max(128) }).strict()

/** Asking whoever can sign a conversation's agent in: the people who can act, never the requester. */
export function registerSignInRequestRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  const path = '/agent-runtimes/:runtimeId/sign-in-requests'

  teamScoped.post(path, zv('json', body), async (c) =>
    c.json(
      await nudge(
        'signInRequest',
        {
          teamId: c.get('teamId'),
          runtimeId: c.req.param('runtimeId'),
          sessionId: c.req.valid('json').sessionId,
          requesterId: c.get('userId'),
        },
        c.get('teamRole'),
      ),
    ),
  )
  // A computer's agent signed in through its own CLI: no runtime sign-in saw it connect.
  teamScoped.delete(path, requireLoginRole, async (c) => {
    await settleSignInRequests(c.get('teamId'), c.req.param('runtimeId'))

    return c.body(null, 204)
  })
}
