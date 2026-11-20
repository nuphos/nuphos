import { describe, expect, test } from 'bun:test'

import { computerStillShared, computerStillSharedOrNone } from './conversation-computer-use'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'

const TEAM = 'team'

const mac = (grant: Partial<{ everyone: boolean; userIds: string[]; managerIds: string[] }>) =>
  ({
    _id: 'device-1',
    userId: 'owner',
    deviceId: 'mac',
    label: 'Owner’s Mac',
    createdAt: new Date(0),
    access: [{ teamId: TEAM, everyone: false, userIds: [], managerIds: [], ...grant }],
  }) as unknown as AgentDevice

const depsFor = (device: AgentDevice): DeviceAccessDeps => ({
  getDevice: async (userId, deviceId) => (userId === 'owner' && deviceId === 'mac' ? device : null),
  listDevices: async () => [],
  listBoxes: async () => [],
  listGranted: async () => [],
  findGranted: async (_team, deviceId) => (deviceId === 'mac' ? [device] : []),
  role: async () => 'EDITOR',
})

const chat = { userId: 'owner', teamId: TEAM, runtimeId: 'local_owner_mac' }

describe('after removing someone from a chat, the remover is told they can still use its computer', () => {
  test('when the remover owns or manages it and the person still uses it by name', async () => {
    const device = mac({ userIds: ['leo', 'maya'], managerIds: ['maya'] })

    for (const actor of ['owner', 'maya'])
      expect(await computerStillShared(chat, actor, 'leo', depsFor(device))).toEqual({
        deviceId: 'mac',
        label: 'Owner’s Mac',
      })
  })

  test('not when the remover only uses the computer themselves', async () => {
    const device = mac({ userIds: ['leo', 'priya'] })

    expect(await computerStillShared(chat, 'priya', 'leo', depsFor(device))).toBeNull()
  })

  test('not for a computer shared with everyone, its managers, or someone it was never shared with', async () => {
    expect(
      await computerStillShared(chat, 'owner', 'leo', depsFor(mac({ everyone: true }))),
    ).toBeNull()
    expect(
      await computerStillShared(chat, 'owner', 'maya', depsFor(mac({ managerIds: ['maya'] }))),
    ).toBeNull()
    expect(await computerStillShared(chat, 'owner', 'leo', depsFor(mac({})))).toBeNull()
  })

  test('not when someone leaves on their own, nor for a chat on no one’s computer', async () => {
    const device = mac({ userIds: ['leo'] })

    expect(await computerStillShared(chat, 'leo', 'leo', depsFor(device))).toBeNull()
    expect(
      await computerStillShared(
        { ...chat, runtimeId: 'managed-1' },
        'owner',
        'leo',
        depsFor(device),
      ),
    ).toBeNull()
  })

  test('a check that fails gives no notice instead of an error', async () => {
    const broken: DeviceAccessDeps = {
      ...depsFor(mac({ userIds: ['leo'] })),
      getDevice: () => Promise.reject(new Error('db down')),
      findGranted: () => Promise.reject(new Error('db down')),
    }

    await expect(computerStillShared(chat, 'owner', 'leo', broken)).rejects.toThrow('db down')
    expect(await computerStillSharedOrNone(chat, 'owner', 'leo', broken)).toBeNull()
  })
})
