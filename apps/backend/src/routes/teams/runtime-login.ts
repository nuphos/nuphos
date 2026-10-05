import { z } from 'zod'

import {
  AUTHORIZATION_CODE,
  cancelRuntimeLogin,
  requireLoginInstance,
  startRuntimeLogin,
  submitRuntimeLoginCode,
} from '@/lib/claude-code-preview/runtime-login'
import { publicLogin, readRuntimeLogin } from '@/lib/claude-code-preview/runtime-login-store'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerRuntimeLoginRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  const path = '/agent-runtimes/:runtimeId/login'

  teamScoped.post(path, requireTeamRole('ADMINISTRATOR'), async (c) => {
    c.header('Cache-Control', 'no-store')

    return c.json(
      await startRuntimeLogin(c.get('teamId'), c.req.param('runtimeId'), c.get('userId')),
      202,
    )
  })
  teamScoped.get(path, requireTeamRole('ADMINISTRATOR'), async (c) => {
    c.header('Cache-Control', 'no-store')
    await requireLoginInstance(c.get('teamId'), c.req.param('runtimeId'))

    return c.json(
      publicLogin(
        await readRuntimeLogin(c.get('teamId'), c.req.param('runtimeId'), c.get('userId')),
      ),
    )
  })
  teamScoped.delete(
    path,
    requireTeamRole('ADMINISTRATOR'),
    zv('json', z.object({ attemptId: z.string().uuid() }).strict()),
    async (c) => {
      await cancelRuntimeLogin(
        c.get('teamId'),
        c.req.param('runtimeId'),
        c.get('userId'),
        c.req.valid('json').attemptId,
      )

      return c.body(null, 204)
    },
  )
  teamScoped.post(
    `${path}/code`,
    requireTeamRole('ADMINISTRATOR'),
    zv(
      'json',
      z
        .object({
          attemptId: z.string().uuid(),
          code: z
            .string()
            .trim()
            .regex(AUTHORIZATION_CODE, 'Paste the whole code or address the sign-in page shows'),
        })
        .strict(),
    ),
    async (c) => {
      c.header('Cache-Control', 'no-store')
      const { attemptId, code } = c.req.valid('json')

      return c.json(
        await submitRuntimeLoginCode(
          c.get('teamId'),
          c.req.param('runtimeId'),
          c.get('userId'),
          attemptId,
          code,
        ),
      )
    },
  )
}
