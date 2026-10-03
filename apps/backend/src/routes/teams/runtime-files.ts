import { z } from 'zod'

import { listRuntimeFiles, readRuntimeFile } from '@/lib/claude-code-preview/runtime-file'
import { zv } from '@/lib/validate'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerRuntimeFileRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.get(
    '/agent-runtimes/:runtimeId/files/content',
    zv(
      'query',
      z.object({
        sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
        path: z.string().min(1).max(4096),
      }),
    ),
    async (c) => {
      const { sessionId, path } = c.req.valid('query')

      c.header('Cache-Control', 'no-store')

      return c.json(
        await readRuntimeFile(
          c.get('teamId'),
          c.get('userId'),
          c.req.param('runtimeId'),
          sessionId,
          path,
        ),
      )
    },
  )
  teamScoped.get(
    '/agent-runtimes/:runtimeId/files',
    zv(
      'query',
      z.object({
        sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
        path: z.string().min(1).max(4096),
      }),
    ),
    async (c) => {
      const { sessionId, path } = c.req.valid('query')

      c.header('Cache-Control', 'no-store')

      return c.json(
        await listRuntimeFiles(
          c.get('teamId'),
          c.get('userId'),
          c.req.param('runtimeId'),
          sessionId,
          path,
        ),
      )
    },
  )
}
