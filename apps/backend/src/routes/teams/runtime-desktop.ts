import { upgradeWebSocket } from 'hono/bun'

import {
  openRuntimeDesktop,
  runtimeDesktopEvents,
  runtimeDesktopTarget,
} from '@/lib/claude-code-preview/runtime-desktop'
import { AppError } from '@/lib/errors'

import type { DesktopOwner } from '@/lib/claude-code-preview/runtime-desktop'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { Context, Hono } from 'hono'

export function registerRuntimeDesktopRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  const streamDesktop = async (
    c: Context<{ Variables: TeamAuthVariables }>,
    owner: DesktopOwner,
    display: string,
  ) => {
    const target = await runtimeDesktopTarget(c.get('teamId'), c.get('userId'), owner, display)

    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
      throw new AppError(426, 'upgrade_required', 'Connect with a WebSocket')

    return upgradeWebSocket(c as unknown as Context, runtimeDesktopEvents(target))
  }

  // A computer's own desktop, keyed by its runtime. Each route has one segment
  // more than the conversation route of its method, so neither shadows the
  // other: a session id of "runtime" still reaches the conversation routes.
  teamScoped.post('/runtime-desktop/runtime/:runtimeId', async (c) =>
    c.json(
      await openRuntimeDesktop(c.get('teamId'), c.get('userId'), {
        runtimeId: c.req.param('runtimeId'),
      }),
    ),
  )
  teamScoped.get('/runtime-desktop/runtime/:runtimeId/:display', (c) =>
    streamDesktop(c, { runtimeId: c.req.param('runtimeId') }, c.req.param('display')),
  )

  teamScoped.post('/runtime-desktop/:sessionId', async (c) =>
    c.json(await openRuntimeDesktop(c.get('teamId'), c.get('userId'), c.req.param('sessionId'))),
  )

  teamScoped.get('/runtime-desktop/:sessionId/:display', (c) =>
    streamDesktop(c, c.req.param('sessionId'), c.req.param('display')),
  )
}
