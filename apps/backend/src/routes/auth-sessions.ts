import { Hono } from 'hono'

import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

import { AppError } from '@/lib/errors'
import { listUserSessions, revokeUserSession } from '@/lib/identity/sessions'
import { requireAuth } from '@/middleware/auth'

/** The account's sign-in sessions, mounted at /auth/sessions. */
export const authSessions = new Hono<{ Variables: AuthVariables }>()

/** Only a signed-in session may see or end the account's sessions, not an agent run. */
function requireSession(c: Context<{ Variables: AuthVariables }>): string {
  const sessionId = c.get('sessionId')

  if (!sessionId) throw new AppError(403, 'session_required', 'Sign in to manage your sessions')

  return sessionId
}

authSessions.get('/', requireAuth, async (c) =>
  c.json({ sessions: await listUserSessions(c.get('userId'), requireSession(c)) }),
)

// `current` signs this client out.
authSessions.delete('/:id', requireAuth, async (c) => {
  const current = requireSession(c)
  const id = c.req.param('id') === 'current' ? current : c.req.param('id')

  if (!(await revokeUserSession(c.get('userId'), id))) {
    throw new AppError(404, 'not_found', 'No such session')
  }

  return c.body(null, 204)
})
