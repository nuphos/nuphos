import { upgradeWebSocket } from 'hono/bun'
import { z } from 'zod'

import { requestBoxCacheClear } from '@/lib/claude-code-preview/box-clear-caches'
import {
  requestComputerAppUpdate,
  setComputerAutoInstall,
} from '@/lib/claude-code-preview/computer-app-update'
import {
  openRuntimeDesktop,
  runtimeDesktopEvents,
  runtimeDesktopTarget,
} from '@/lib/claude-code-preview/runtime-desktop'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { addComputerToVault } from '@/lib/vault-computer'

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

  // The caller's other computer restarts its Nuphos Desktop into the update it downloaded.
  teamScoped.post('/computers/:deviceId/app-update', async (c) =>
    c.json(
      await requestComputerAppUpdate(c.get('teamId'), c.get('userId'), c.req.param('deviceId')),
    ),
  )

  // Whoever manages a computer turns its automatic updates on or off.
  teamScoped.put(
    '/computers/:deviceId/auto-install',
    zv('json', z.object({ enabled: z.boolean() }).strict()),
    async (c) =>
      c.json(
        await setComputerAutoInstall(
          c.get('teamId'),
          c.get('userId'),
          c.req.param('deviceId'),
          c.req.valid('json').enabled,
        ),
      ),
  )

  // Whoever manages a Box frees its disk of the caches its tools rebuild.
  teamScoped.post('/computers/:deviceId/clear-caches', async (c) =>
    c.json(
      await requestBoxCacheClear(c.get('teamId'), c.req.param('deviceId'), c.get('userId')),
      202,
    ),
  )

  // The caller adds a computer they manage to their own vault; it waits for approval.
  teamScoped.post('/computers/:deviceId/vault', async (c) =>
    c.json(
      {
        device: await addComputerToVault(c.get('userId'), c.get('teamId'), c.req.param('deviceId')),
      },
      201,
    ),
  )

  teamScoped.post('/runtime-desktop/:sessionId', async (c) =>
    c.json(await openRuntimeDesktop(c.get('teamId'), c.get('userId'), c.req.param('sessionId'))),
  )

  teamScoped.get('/runtime-desktop/:sessionId/:display', (c) =>
    streamDesktop(c, c.req.param('sessionId'), c.req.param('display')),
  )
}
