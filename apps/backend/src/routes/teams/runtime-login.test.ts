import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'

import { loginRole } from './runtime-login'

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
  teamScoped.post('/agent-runtimes/:runtimeId/login', loginRole(manages), (c) =>
    c.json({ ok: true }),
  )
  teamScoped.onError(errorHandler)

  return teamScoped
}

// Who manages each computer now. box-2 was handed from u2 to u3, so its runtime id still names
// u2; u4 manages box-1 for u1, and u5 only uses it.
const managers: Record<string, string[]> = { 'box-1': ['u1', 'u4'], 'box-2': ['u3'] }
const manages = (userId: string, _teamId: string, deviceId: string) =>
  Promise.resolve(managers[deviceId]?.includes(userId) === true)

const MINE = 'local_u1_box-1'
const THEIRS = 'local_u2_box-2'
const post = (a: Hono<{ Variables: TeamAuthVariables }>, runtimeId: string) =>
  a.request(`/agent-runtimes/${runtimeId}/login`, { method: 'POST' })

describe('who may start an agent sign-in', () => {
  test('an editor signs in the agent on their own computer or Box', async () => {
    expect((await post(app('u1', 'EDITOR'), MINE)).status).toBe(200)
  })

  test('an editor cannot sign in a teammate computer or a team agent', async () => {
    const editor = app('u1', 'EDITOR')

    expect((await post(editor, THEIRS)).status).toBe(403)
    expect((await post(editor, 'managed-1')).status).toBe(403)
  })

  test('an administrator signs in team agents as before', async () => {
    expect((await post(app('admin', 'ADMINISTRATOR'), 'managed-1')).status).toBe(200)
    expect((await post(app('admin', 'ADMINISTRATOR'), THEIRS)).status).toBe(200)
  })

  test('a manager signs in the agents of a computer they manage; one who only uses it cannot', async () => {
    expect((await post(app('u4', 'EDITOR'), MINE)).status).toBe(200)
    expect((await post(app('u5', 'EDITOR'), MINE)).status).toBe(403)
  })

  test('a Box handed to a new owner is theirs to sign in, not its previous owner’s', async () => {
    expect((await post(app('u3', 'VIEWER'), THEIRS)).status).toBe(200)
    expect((await post(app('u2', 'EDITOR'), THEIRS)).status).toBe(403)
  })
})
