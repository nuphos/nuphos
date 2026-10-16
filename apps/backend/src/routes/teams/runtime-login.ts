import { z } from 'zod'

import {
  cancelRuntimeLogin,
  requireLoginInstance,
  startRuntimeLogin,
  submitRuntimeLoginCode,
} from '@/lib/claude-code-preview/runtime-login'
import { publicLogin, readRuntimeLogin } from '@/lib/claude-code-preview/runtime-login-store'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono, MiddlewareHandler } from 'hono'

/**
 * Signing a team's agent in is an administrator's job. A member's own computer or
 * Box is theirs: its runtime id names them, and the endpoint resolution refuses
 * anyone else, so the role check is skipped for it.
 */
export const requireLoginRole: MiddlewareHandler<{ Variables: TeamAuthVariables }> = async (
  c,
  next,
) => {
  if (parseLocalRuntimeId(c.req.param('runtimeId') ?? '')?.userId === c.get('userId')) await next()
  else await requireTeamRole('ADMINISTRATOR')(c, next)
}

export function registerRuntimeLoginRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  const path = '/agent-runtimes/:runtimeId/login'

  teamScoped.post(path, requireLoginRole, async (c) => {
    c.header('Cache-Control', 'no-store')

    return c.json(
      await startRuntimeLogin(c.get('teamId'), c.req.param('runtimeId'), c.get('userId')),
      202,
    )
  })
  teamScoped.get(path, requireLoginRole, async (c) => {
    c.header('Cache-Control', 'no-store')
    await requireLoginInstance(c.get('teamId'), c.req.param('runtimeId'), c.get('userId'))

    return c.json(
      publicLogin(
        await readRuntimeLogin(c.get('teamId'), c.req.param('runtimeId'), c.get('userId')),
      ),
    )
  })
  teamScoped.delete(
    path,
    requireLoginRole,
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
    requireLoginRole,
    zv(
      'json',
      z
        .object({
          attemptId: z.string().uuid(),
          // A code, an address, a choice or a typed value; checked against the step.
          code: z
            .string()
            .trim()
            .min(1)
            .max(4096)
            .regex(/^[^\r\n]+$/u),
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
