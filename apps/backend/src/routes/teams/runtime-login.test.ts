import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { AppError, errorHandler } from '@/lib/errors'

import { loginRole, ownsComputer } from './runtime-login'

import type { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import type { NuphosTeamRole } from '@/lib/identity/types'
import type { TeamAuthVariables } from '@/middleware/auth'

function app(userId: string, teamRole: NuphosTeamRole) {
  const teamScoped = new Hono<{ Variables: TeamAuthVariables }>()

  teamScoped.use('*', async (c, next) => {
    c.set('userId', userId)
    c.set('teamId', 't1')
    c.set('teamRole', teamRole)
    await next()
  })
  teamScoped.post('/agent-runtimes/:runtimeId/login', loginRole(owns), (c) => c.json({ ok: true }))
  teamScoped.onError(errorHandler)

  return teamScoped
}

// Who owns each computer now. box-2 was handed from u2 to u3, so its runtime id still names u2.
const owners: Record<string, string> = { 'box-1': 'u1', 'box-2': 'u3' }
const owns = (userId: string, _teamId: string, ref: { deviceId: string }) =>
  Promise.resolve(owners[ref.deviceId] === userId)

const MINE = 'local_u1_box-1'
const THEIRS = 'local_u2_box-2'
const post = (a: Hono<{ Variables: TeamAuthVariables }>, runtimeId: string) =>
  a.request(`/agent-runtimes/${runtimeId}/login`, { method: 'POST' })

describe('who may start an agent sign-in', () => {
  test('an editor signs in the agent on their own computer or Box', async () => {
    expect((await post(app('u1', 'EDITOR'), MINE)).status).toBe(200)
  })

  test('an editor may start a sign-in on a teammate computer, not on a team agent', async () => {
    const editor = app('u1', 'EDITOR')

    // Whether they may use that computer is checked when the sign-in resolves the agent.
    expect((await post(editor, THEIRS)).status).toBe(200)
    expect((await post(editor, 'managed-1')).status).toBe(403)
  })

  test('a viewer signs in only a computer they own', async () => {
    expect((await post(app('u1', 'VIEWER'), MINE)).status).toBe(200)
    expect((await post(app('u1', 'VIEWER'), THEIRS)).status).toBe(403)
  })

  test('an administrator signs in team agents as before', async () => {
    expect((await post(app('admin', 'ADMINISTRATOR'), 'managed-1')).status).toBe(200)
    expect((await post(app('admin', 'ADMINISTRATOR'), THEIRS)).status).toBe(200)
  })

  test('a Box handed to a new owner is theirs to sign in, not its previous owner’s', async () => {
    expect((await post(app('u3', 'VIEWER'), THEIRS)).status).toBe(200)
    expect((await post(app('u2', 'VIEWER'), THEIRS)).status).toBe(403)
  })
})

type AccessCheck = typeof requireDeviceAccess

describe('owning the computer a runtime id names', () => {
  const device = (userId: string) => () =>
    Promise.resolve({ userId, deviceId: 'box-2' } as Awaited<ReturnType<AccessCheck>>)

  test('needs the id’s transport user as well as owner access', async () => {
    const ref = { userId: 'u2', deviceId: 'box-2' }

    expect(await ownsComputer('u3', 't1', ref, device('u2'))).toBe(true)
    // Your own computer that happens to share the device id is not the one the id names.
    expect(await ownsComputer('u3', 't1', ref, device('u3'))).toBe(false)
    expect(
      await ownsComputer('u3', 't1', ref, () =>
        Promise.reject(new AppError(404, 'device_not_found', 'Device is not available')),
      ),
    ).toBe(false)
  })
})
