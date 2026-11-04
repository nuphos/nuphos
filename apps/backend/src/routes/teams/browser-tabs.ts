import { upgradeWebSocket } from 'hono/bun'

import { runtimeDesktopEvents } from '@/lib/claude-code-preview/runtime-desktop'
import {
  browserTabsOf,
  closeSessionDockTab,
  focusSessionBrowserTab,
  openSessionDockTab,
  sessionBrowserViewTarget,
  sessionDock,
} from '@/lib/claude-code-preview/session-browser-tabs'
import { AppError } from '@/lib/errors'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Context, Hono } from 'hono'

/** A workspace tab id; the Mac only answers for one in this conversation's dock. */
const TAB_ID = /^[\w-]{1,128}$/

function tabParam(c: Context): string {
  const tab = c.req.param('tab') ?? ''

  if (!TAB_ID.test(tab)) throw new AppError(400, 'invalid_tab', 'tab is not a tab id')

  return tab
}

/** A conversation's dock browser tabs, listed and brought forward from another screen. */
export function registerBrowserTabRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  // `dock` is the whole dock, as the phone mirrors it; `tabs` its browser tabs, for older iPhone builds.
  teamScoped.get('/browser-tabs/:sessionId', async (c) => {
    const dock = await sessionDock(c.get('teamId'), c.get('userId'), c.req.param('sessionId'))

    return c.json({ tabs: browserTabsOf(dock), dock })
  })

  // Opens a page in the dock on the Mac: `{ href }`, an app path of this team, or `{ page }`, a workspace page key.
  teamScoped.post('/browser-tabs/:sessionId', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { href?: unknown; page?: unknown } | null
    const target =
      typeof body?.href === 'string'
        ? { href: body.href }
        : typeof body?.page === 'string'
          ? { page: body.page }
          : null

    if (!target) throw new AppError(400, 'invalid_body', 'href or page is required')
    const id = await openSessionDockTab(
      c.get('teamId'),
      c.get('userId'),
      c.req.param('sessionId'),
      target,
    )

    return c.json({ id })
  })

  teamScoped.delete('/browser-tabs/:sessionId/:tab', async (c) => {
    await closeSessionDockTab(
      c.get('teamId'),
      c.get('userId'),
      c.req.param('sessionId'),
      tabParam(c),
    )

    return c.json({ ok: true })
  })

  teamScoped.post('/browser-tabs/:sessionId/:tab/focus', async (c) => {
    await focusSessionBrowserTab(
      c.get('teamId'),
      c.get('userId'),
      c.req.param('sessionId'),
      tabParam(c),
    )

    return c.json({ ok: true })
  })

  // A phone watching the tab live, as RFB over the desktop viewer's relay; `w`×`h` is its page in CSS pixels.
  teamScoped.get('/browser-tabs/:sessionId/:tab/view', async (c) => {
    const tab = {
      id: tabParam(c),
      width: Number(c.req.query('w')) || 390,
      height: Number(c.req.query('h')) || 844,
    }
    const target = await sessionBrowserViewTarget(
      c.get('teamId'),
      c.get('userId'),
      c.req.param('sessionId'),
      tab,
    )

    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
      throw new AppError(426, 'upgrade_required', 'Connect with a WebSocket')

    return upgradeWebSocket(c as unknown as Context, runtimeDesktopEvents(target))
  })
}
