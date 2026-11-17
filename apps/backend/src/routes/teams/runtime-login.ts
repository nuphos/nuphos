import { z } from 'zod'

import {
  cancelRuntimeLogin,
  requireLoginInstance,
  startRuntimeLogin,
  submitRuntimeLoginCode,
} from '@/lib/claude-code-preview/runtime-login'
import { publicLogin, readRuntimeLogin } from '@/lib/claude-code-preview/runtime-login-store'
import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono, MiddlewareHandler } from 'hono'

/** Whether this person manages the computer; a Box's owner is whoever holds it now. */
async function managesComputer(userId: string, teamId: string, deviceId: string): Promise<boolean> {
  try {
    await requireDeviceAccess(userId, teamId, deviceId, 'manage')

    return true
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return false
    throw error
  }
}

/**
 * Signing a team's agent in is an administrator's job. Those who manage a computer sign in its
 * agents themselves, a Box's new owner included, though its runtime id still names the
 * transport user; those who only use it do not. The endpoint resolution checks access again.
 */
export function loginRole(
  manages: typeof managesComputer = managesComputer,
): MiddlewareHandler<{ Variables: TeamAuthVariables }> {
  return async (c, next) => {
    const ref = parseLocalRuntimeId(c.req.param('runtimeId') ?? '')

    if (ref && (await manages(c.get('userId'), c.get('teamId'), ref.deviceId))) await next()
    else await requireTeamRole('ADMINISTRATOR')(c, next)
  }
}

export const requireLoginRole = loginRole()

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
