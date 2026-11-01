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
  shares: [{ teamId: 'team', level: 'full', everyone: true, userIds: [] }],
})

function setup() {
  const log: string[] = []
  const record = (entry: string) => {
    log.push(entry)
  }
  const deps: MemberRevocationDeps = {
    revokeTeamBoxStreams: async () => record('boxes'),
    dropFromTeamBoxAccess: async () => record('box-access'),
    listShared: async () => [computer('owner'), computer('other')],
    revokeStreams: async (devices, actorIds) =>
      record(
        `streams ${devices.map((device) => device.userId).join(',')} -> ${actorIds.join(',')}`,
      ),
    dropFromShares: async (_team, userId) => record(`drop-from-shares ${userId}`),
    dropOwnerShares: async (_team, userId) => record(`drop-owner-shares ${userId}`),
    dropApprovals: async (_team, userId) => record(`drop-approvals ${userId}`),
    dropTrusts: async (_team, userId) => record(`drop-trusts ${userId}`),
    // The person who left is no longer a member.
    memberIds: async () => ['other', 'mate'],
  }

  return { log, deps }
}

test('a guest leaving loses their streams, their place in shares, and their approvals', async () => {
  const { log, deps } = setup()

  await revokeTeamMemberAccess('team', 'mate', deps)

  expect(log).toEqual([
    'boxes',
    'box-access',
    'streams owner,other -> mate',
    'drop-from-shares mate',
    'drop-owner-shares mate',
    'drop-approvals mate',
    'drop-trusts mate',
  ])
})

test('an owner leaving closes every teammate’s stream on their computer and unshares it', async () => {
  const { log, deps } = setup()

  await revokeTeamMemberAccess('team', 'owner', deps)

  expect(log).toContain('streams other -> owner')
  expect(log).toContain('streams owner -> other,mate')
  expect(log).toContain('drop-owner-shares owner')
  // Rejoining starts over: no approval from before carries over.
  expect(log).toContain('drop-approvals owner')
})
