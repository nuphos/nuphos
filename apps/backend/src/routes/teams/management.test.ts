import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstabox } from '@/lib/test/doubles/box-instabox'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentDevice } from '@/lib/agent/devices/store'
import type { TransferTeamOwnershipResult } from '@/lib/identity/team-roles'
import type { NuphosTeam, NuphosTeamMember } from '@/lib/identity/types'
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
const TEAM: NuphosTeam = {
  id: 'team-1',
  name: 'Workspace',
  avatarUrl: '',
  ownerID: 'owner-1',
  contactEmails: [],
  allowedEmailDomains: [],
  agentRuntime: 'claude-code',
  createdAt: '2026-10-01T00:00:00.000Z',
  billing: { activated: true, active: true },
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

// Teams the route marked deleted.
const deletedTeams: string[] = []

useIdentity({
  getTeamMembers: (teamId, opts) => {
    if (teamId !== 'team-1') return Promise.resolve([])

    return Promise.resolve(
      opts?.includeRemoved ? [REJOINED_TOMBSTONE, MEMBER, EARLIER_REMOVED, REMOVED] : [MEMBER],
    )
  },
  transferTeamOwnership: (_teamId, newOwnerId) => Promise.resolve(TRANSFER_RESULTS[newOwnerId]!),
  updateTeamMemberRole: (_teamId, _memberId, role) =>
    Promise.resolve({ kind: 'updated', member: { ...MEMBER, role } } as never),
  deleteTeam: (teamId) => {
    deletedTeams.push(teamId)

    return Promise.resolve(teamId === 'team-other-owner' ? 'forbidden' : 'deleted')
  },
})

// Which team's cloud computers were looked up to close someone's open agents on them.
const boxLookups: string[] = []

// What deleting a team did to its Boxes: machines killed and rows removed, per owner/device.
const killed: string[] = []
const removed: string[] = []

useAgentDeviceStore({
  listTeamBoxes: async (teamId: string) => {
    boxLookups.push(teamId)
    if (teamId === 'team-1') return []
    if (teamId === 'team-boxes-unreadable') throw new Error('store unavailable')

    const boxes = [
      { userId: 'owner-1', deviceId: 'box-a' },
      { userId: 'member-2', deviceId: 'box-b' },
    ] as AgentDevice[]

    return teamId === 'team-broken-box'
      ? [{ userId: 'owner-1', deviceId: 'box-broken' } as AgentDevice, ...boxes]
      : boxes
  },
  getAgentDevice: () => Promise.resolve(null),
  revokeAgentDeviceCredential: () => Promise.resolve(false),
  deleteAgentDevice: (userId: string, deviceId: string) => {
    removed.push(`${userId}/${deviceId}`)

    return Promise.resolve(true)
  },
})

useBoxInstabox({
  destroyBox: (userId: string, deviceId: string) => {
    if (deviceId === 'box-broken') return Promise.reject(new Error('store unavailable'))
    killed.push(`${userId}/${deviceId}`)

    return Promise.resolve(true)
  },
})

const { registerTeamManagementRoutes } = await import('./management')

function createApp(teamId = 'team-1', userEmail = 'admin@example.com') {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('teamId', teamId)
    c.set('teamRole', 'ADMINISTRATOR')
    c.set('userEmail', userEmail)
    c.set('team', { ...TEAM, id: teamId })
    await next()
  })
  registerTeamManagementRoutes(app)

  return app
}

describe('GET /', () => {
  test('says whether the viewer’s email domain is a public provider', async () => {
    for (const [email, isPublic] of [
      ['bryan@gmail.com', true],
      ['admin@example.com', false],
    ] as const) {
      const body = (await (await createApp('team-1', email).request('/')).json()) as {
        viewerEmailDomainPublic: boolean
      }

      expect(body.viewerEmailDomainPublic).toBe(isPublic)
    }
  })
})

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

describe('PATCH /members/:memberId', () => {
  test('changing a role leaves what the person has open on the team’s computers alone', async () => {
    boxLookups.length = 0
    for (const role of ['EDITOR', 'VIEWER'] as const) {
      const response = await createApp().request('/members/000000000000000000000009', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })

      expect(response.status).toBe(200)
    }
    // Since #1391 a team role confers nothing on a computer: only its access list does.
    expect(boxLookups).toEqual([])
  })
})

describe('DELETE /', () => {
  test('deleting a team deletes every Box the team owns', async () => {
    killed.length = 0
    removed.length = 0
    const response = await createApp('team-with-boxes').request('/', { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(killed).toEqual(['owner-1/box-a', 'member-2/box-b'])
    expect(removed).toEqual(['owner-1/box-a', 'member-2/box-b'])
  })

  test('a refused delete leaves the team’s Boxes alone', async () => {
    killed.length = 0
    removed.length = 0
    const response = await createApp('team-other-owner').request('/', { method: 'DELETE' })

    expect(response.status).toBe(403)
    expect(killed).toEqual([])
    expect(removed).toEqual([])
  })

  test('one Box that fails to delete does not stop the others or the team delete', async () => {
    killed.length = 0
    removed.length = 0
    const response = await createApp('team-broken-box').request('/', { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(killed).toEqual(['owner-1/box-a', 'member-2/box-b'])
    expect(removed).toEqual(['owner-1/box-a', 'member-2/box-b'])
  })

  test('when the team’s Boxes cannot be read, the team is not deleted, so the delete can be retried', async () => {
    deletedTeams.length = 0
    const response = await createApp('team-boxes-unreadable').request('/', { method: 'DELETE' })

    expect(response.status).toBe(500)
    expect(deletedTeams).toEqual([])
  })
})
