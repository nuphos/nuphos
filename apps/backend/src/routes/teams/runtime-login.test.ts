import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'

import { requireLoginRole } from './runtime-login'

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
  teamScoped.post('/agent-runtimes/:runtimeId/login', requireLoginRole, (c) => c.json({ ok: true }))
  teamScoped.onError(errorHandler)

  return teamScoped
}

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
  })
})
