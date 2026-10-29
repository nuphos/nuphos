import { z } from 'zod'

import { nudge } from '@/lib/agent/sign-in-request'
import { settleSignInRequests } from '@/lib/agent/sign-in-settle'
import { zv } from '@/lib/validate'

import { requireLoginRole } from './runtime-login'

import type { NudgeKind } from '@/lib/agent/sign-in-request'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const body = z.object({ sessionId: z.string().min(1).max(128) }).strict()

/**
 * Asking whoever can sign a conversation's agent in, and reminding a computer's
 * owner to approve it: both notify the people who can act, never the requester.
 */
export function registerSignInRequestRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  const path = '/agent-runtimes/:runtimeId/sign-in-requests'
  const ask = (kind: NudgeKind) =>
    teamScoped.post(
      kind === 'signInRequest' ? path : '/agent-runtimes/:runtimeId/share-reminders',
      zv('json', body),
      async (c) =>
        c.json(
          await nudge(
            kind,
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

  ask('signInRequest')
  ask('approvalReminder')
  // A computer's agent signed in through its own CLI: no runtime sign-in saw it connect.
  teamScoped.delete(path, requireLoginRole, async (c) => {
    await settleSignInRequests(c.get('teamId'), c.req.param('runtimeId'))

    return c.body(null, 204)
  })
}
