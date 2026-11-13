import { expect, test } from 'bun:test'

import { revokeTeamMemberAccess } from './local-share-revoke'

import type { MemberRevocationDeps } from './local-share-revoke'
import type { AgentDevice } from './store'

const computer = (userId: string): AgentDevice => ({
  userId,
  deviceId: `${userId}-mac`,
  label: `${userId}’s Mac`,
  platform: 'darwin',
  allowLocalExec: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  access: [{ teamId: 'team', everyone: true, userIds: [], managerIds: [] }],
})

function setup() {
  const log: string[] = []
  const record = (entry: string) => {
    log.push(entry)
  }
  const deps: MemberRevocationDeps = {
    revokeTeamBoxStreams: async () => record('boxes'),
    listGranted: async () => [computer('owner'), computer('other')],
    revokeStreams: async (devices, actorIds) =>
      record(
        `streams ${devices.map((device) => device.userId).join(',')} -> ${actorIds.join(',')}`,
      ),
    dropFromGrants: async (_team, userId, by) =>
      record(`drop-from-grants ${userId} by ${by.actorUserId} ${by.via}`),
    dropOwnerGrants: async (_team, userId, by) =>
      record(`drop-owner-grants ${userId} by ${by.actorUserId} ${by.via}`),
    transferComputers: (_team, from, to, by) => {
      record(`transfer ${from} -> ${to} by ${by.actorUserId} ${by.via}`)

      return Promise.resolve()
    },
    teamOwner: () => Promise.resolve('boss'),
    dropApprovals: async (_team, userId) => record(`drop-approvals ${userId}`),
    dropTrusts: async (_team, userId) => record(`drop-trusts ${userId}`),
    // The person who left is no longer a member.
    memberIds: async () => ['other', 'mate'],
  }

  return { log, deps }
}

test('a guest leaving loses their streams, their place in grants, and their approvals', async () => {
  const { log, deps } = setup()

  await revokeTeamMemberAccess('team', 'mate', { actorUserId: 'mate', via: 'team_leave' }, deps)

  expect(log).toEqual([
    'boxes',
    'streams owner,other -> mate',
    'drop-from-grants mate by mate team_leave',
    'drop-owner-grants mate by mate team_leave',
    'transfer mate -> boss by mate team_leave',
    'drop-approvals mate',
    'drop-trusts mate',
  ])
})

test('an owner leaving closes every teammate’s stream on their computer and ungrants it', async () => {
  const { log, deps } = setup()

  await revokeTeamMemberAccess('team', 'owner', { actorUserId: 'owner', via: 'team_leave' }, deps)

  expect(log).toContain('streams other -> owner')
  expect(log).toContain('streams owner -> other,mate')
  expect(log).toContain('drop-owner-grants owner by owner team_leave')
  // The team's cloud computers they owned pass to the team's owner.
  expect(log).toContain('transfer owner -> boss by owner team_leave')
  // Rejoining starts over: no approval from before carries over.
  expect(log).toContain('drop-approvals owner')
})

test('the team’s owner leaving keeps the cloud computers they own', async () => {
  const { log, deps } = setup()

  await revokeTeamMemberAccess('team', 'boss', { actorUserId: 'boss', via: 'team_leave' }, deps)

  expect(log.some((entry) => entry.startsWith('transfer'))).toBe(false)
})
