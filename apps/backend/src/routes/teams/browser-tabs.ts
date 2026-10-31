import {
  focusSessionBrowserTab,
  sessionBrowserTabs,
} from '@/lib/claude-code-preview/session-browser-tabs'
import { AppError } from '@/lib/errors'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

/** A conversation's dock browser tabs, listed and brought forward from another screen. */
export function registerBrowserTabRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.get('/browser-tabs/:sessionId', async (c) =>
    c.json({
      tabs: await sessionBrowserTabs(c.get('teamId'), c.get('userId'), c.req.param('sessionId')),
    }),
  )

  teamScoped.post('/browser-tabs/:sessionId/:tab/focus', async (c) => {
    const tab = Number(c.req.param('tab'))

    if (!Number.isInteger(tab)) throw new AppError(400, 'invalid_tab', 'tab must be an integer')
    await focusSessionBrowserTab(c.get('teamId'), c.get('userId'), c.req.param('sessionId'), tab)

    return c.json({ ok: true })
  })
}
