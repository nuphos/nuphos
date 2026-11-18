import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'

import type { NuphosTeamRole } from '@/lib/identity/types'
import type { TeamInvitation } from '@/models'

const TEAM = new ObjectId()
const INVITER = new ObjectId()
const INVITEE = new ObjectId().toHexString()
let row: TeamInvitation
let inviterRole: NuphosTeamRole | null
let joined: { teamId: string; userId: string; role?: NuphosTeamRole }[]

useAuthMiddleware({
  requireAuth: async (c, next) => {
    c.set('userId', INVITEE)
    c.set('userEmail', 'leo@acme.dev')
    await next()
  },
})
useIdentity({
  getTeamMembership: async (userId, teamId) =>
    userId === INVITER.toHexString() && teamId === TEAM.toHexString() && inviterRole
      ? ({ role: inviterRole, team: {} } as never)
      : null,
  addUserToTeam: async (teamId, userId, role) => {
    joined.push({ teamId, userId, role })

    return true
  },
})
useModels({
  teamInvitations: () =>
    ({
      findOneAndUpdate: async (_filter: unknown, update: { $set: object }) =>
        Object.assign(row, update.$set),
    }) as never,
})

const { invitationsRoutes } = await import('./invitations')
const accept = () =>
  invitationsRoutes.request(`/${row._id.toHexString()}/accept`, { method: 'POST' })

beforeEach(() => {
  joined = []
  inviterRole = 'ADMINISTRATOR'
})

const invite = (role?: NuphosTeamRole) => {
  row = {
    _id: new ObjectId(),
    inviterId: INVITER,
    teamId: TEAM,
    invitedAt: new Date(),
    inviteeEmail: 'leo@acme.dev',
    ...(role ? { role } : {}),
  }
}

test('an Admin invitation makes an Admin while its inviter is still one', async () => {
  invite('ADMINISTRATOR')
  expect((await accept()).status).toBe(200)
  expect(joined).toEqual([{ teamId: TEAM.toHexString(), userId: INVITEE, role: 'ADMINISTRATOR' }])
})

test('an Admin invitation from someone no longer an admin, or gone, joins as Editor', async () => {
  for (const now of ['EDITOR', 'VIEWER', null] as const) {
    inviterRole = now
    invite('ADMINISTRATOR')
    expect(await (await accept()).json()).toMatchObject({ invitation: { role: 'EDITOR' } })
  }
  expect(joined.map((one) => one.role)).toEqual(['EDITOR', 'EDITOR', 'EDITOR'])
})

test('other roles are given as stored, whatever the inviter is now', async () => {
  inviterRole = null
  for (const role of ['VIEWER', 'EDITOR', undefined] as const) {
    invite(role)
    await accept()
  }
  expect(joined.map((one) => one.role)).toEqual(['VIEWER', 'EDITOR', 'EDITOR'])
})
