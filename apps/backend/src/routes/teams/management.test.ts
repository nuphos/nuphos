import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { TransferTeamOwnershipResult } from '@/lib/identity/team-roles'
import type { NuphosTeamMember } from '@/lib/identity/types'
import type { TeamAuthVariables } from '@/middleware/auth'

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

const TRANSFER_RESULTS: Record<string, TransferTeamOwnershipResult> = {
  '000000000000000000000001': 'transferred',
  '000000000000000000000002': 'member_not_found',
  '000000000000000000000003': 'self',
  '000000000000000000000004': 'forbidden',
}

useIdentity({
  getTeamMembers: (teamId, opts) => {
    if (teamId !== 'team-1') return Promise.resolve([])

    return Promise.resolve(
      opts?.includeRemoved ? [REJOINED_TOMBSTONE, MEMBER, EARLIER_REMOVED, REMOVED] : [MEMBER],
    )
  },
  transferTeamOwnership: (_teamId, newOwnerId) => Promise.resolve(TRANSFER_RESULTS[newOwnerId]!),
})

const { registerTeamManagementRoutes } = await import('./management')

function createApp(teamId = 'team-1') {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('teamId', teamId)
    c.set('teamRole', 'ADMINISTRATOR')
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

function transfer(userId: string) {
  return createApp().request('/transfer-ownership', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
}

describe('POST /transfer-ownership', () => {
  test('returns 204 once ownership moves', async () => {
    expect((await transfer('000000000000000000000001')).status).toBe(204)
  })

  test('maps refusals to their status codes', async () => {
    expect((await transfer('000000000000000000000002')).status).toBe(404)
    expect((await transfer('000000000000000000000003')).status).toBe(409)
    expect((await transfer('000000000000000000000004')).status).toBe(403)
  })

  test('rejects a malformed userId', async () => {
    expect((await transfer('not-an-id')).status).toBe(400)
  })
})
