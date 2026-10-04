import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { NuphosTeamMember } from '@/lib/identity/types'
import type { TeamAuthVariables } from '@/middleware/auth'

import { errorHandler } from '@/lib/errors'
import { useIdentity } from '@/lib/test/doubles/identity'

const MEMBER: NuphosTeamMember = {
  id: 'member-1',
  email: 'member@example.com',
  name: 'Member',
  username: 'member',
  avatarURL: '',
  language: 'en',
  createdAt: '2026-10-02T00:00:00.000Z',
  role: 'VIEWER',
  joinedAt: '2026-10-02T00:00:00.000Z',
}
const REMOVED = { ...MEMBER, id: 'removed-1', removedAt: '2026-10-02T01:00:00.000Z' }
const REJOINED_TOMBSTONE = { ...REMOVED, id: MEMBER.id, role: 'EDITOR' as const }
const EARLIER_REMOVED = { ...REMOVED, role: 'ADMINISTRATOR' as const }

useIdentity({
  getTeamMembers: (teamId, opts) => {
    if (teamId !== 'team-1') return Promise.resolve([])

    return Promise.resolve(
      opts?.includeRemoved ? [REJOINED_TOMBSTONE, MEMBER, EARLIER_REMOVED, REMOVED] : [MEMBER],
    )
  },
})

const { registerTeamManagementRoutes } = await import('./management')

function createApp(teamId = 'team-1') {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('teamId', teamId)
    await next()
  })
  registerTeamManagementRoutes(app)

  return app
}

describe('GET /members/:memberId', () => {
  test('returns the member from the current team', async () => {
    const response = await createApp().request('/members/member-1')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ member: MEMBER })
  })

  test('prefers the active membership after a rejoin even when removed rows are included', async () => {
    const response = await createApp().request('/members/member-1?includeRemoved=true')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ member: MEMBER })
  })

  test('returns 404 for missing or other-team members', async () => {
    expect((await createApp().request('/members/unknown')).status).toBe(404)
    expect((await createApp('team-2').request('/members/member-1')).status).toBe(404)
  })

  test('excludes removed members unless explicitly requested', async () => {
    expect((await createApp().request('/members/removed-1')).status).toBe(404)
    const response = await createApp().request('/members/removed-1?includeRemoved=true')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ member: REMOVED })
  })
})
