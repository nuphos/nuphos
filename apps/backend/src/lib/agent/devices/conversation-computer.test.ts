import { describe, expect, test } from 'bun:test'

import {
  computerUseGap,
  resolveConversationAccess,
  resolveConversationAccessList,
} from './conversation-computer'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'

const TEAM = 'team'
const mac = {
  userId: 'owner',
  deviceId: 'mac',
  label: 'Mac',
  createdAt: new Date(0),
  access: [{ teamId: TEAM, everyone: false, userIds: ['user'], managerIds: [] }],
} as unknown as AgentDevice
let lookups = 0
const deps: DeviceAccessDeps = {
  getDevice: async (userId, deviceId) => (userId === 'owner' && deviceId === 'mac' ? mac : null),
  listDevices: async () => [],
  listBoxes: async () => [],
  listGranted: async () => [],
  findGranted: async (_team, deviceId) => {
    lookups++

    return deviceId === 'mac' ? [mac] : []
  },
  role: async () => 'EDITOR',
}
const onMac = {
  userId: 'owner',
  teamId: TEAM,
  generalAccess: 'view' as const,
  participantIds: ['user', 'reader'],
  runtimeId: 'local_owner_mac',
}

describe('resolveConversationAccess', () => {
  test('a participant replies while they may use the computer, else reads', async () => {
    expect(await resolveConversationAccess(onMac, 'owner', deps)).toBe('owner')
    expect(await resolveConversationAccess(onMac, 'user', deps)).toBe('reply')
    expect(await resolveConversationAccess(onMac, 'reader', deps)).toBe('view')
    expect(await resolveConversationAccess(onMac, 'stranger', deps)).toBe('view')
    expect(
      await resolveConversationAccess({ ...onMac, generalAccess: 'none' }, 'stranger', deps),
    ).toBeNull()
  })

  test('a team runtime serves every participant', async () => {
    const managed = { ...onMac, runtimeId: 'managed-1' }

    expect(await resolveConversationAccess(managed, 'reader', deps)).toBe('reply')
  })

  test('a computer that is gone takes reply away', async () => {
    expect(
      await resolveConversationAccess({ ...onMac, runtimeId: 'local_owner_gone' }, 'user', deps),
    ).toBe('view')
  })
})

test('a page asks about each computer once per viewer', async () => {
  lookups = 0
  const page = [onMac, { ...onMac, sessionId: 'b' }, { ...onMac, userId: 'user' }]

  expect(await resolveConversationAccessList(page, 'user', deps)).toEqual([
    'reply',
    'reply',
    'owner',
  ])
  expect(lookups).toBe(1)
})

test('the gap names who cannot use the computer, and whether the actor can give it', async () => {
  expect(await computerUseGap(onMac, 'owner', ['user'], deps)).toBeUndefined()
  expect(await computerUseGap(onMac, 'owner', ['user', 'reader'], deps)).toMatchObject({
    computer: { deviceId: 'mac' },
    needing: ['reader'],
    canGrant: true,
  })
  // Someone who only uses the computer cannot give it away.
  expect(await computerUseGap(onMac, 'user', ['reader'], deps)).toMatchObject({ canGrant: false })
  expect(
    await computerUseGap({ ...onMac, runtimeId: 'managed-1' }, 'owner', ['reader'], deps),
  ).toBeUndefined()
})
