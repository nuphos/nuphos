import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'

const TEAM = 'team'
const calls: { filter: unknown; update: unknown; options: unknown }[] = []
const audits: Record<string, unknown>[] = []
let matches: AgentDevice[] = []

useDb({
  db: () => ({
    collection: () => ({
      findOneAndUpdate: (filter: unknown, update: unknown, options: unknown) => {
        calls.push({ filter, update, options })

        return Promise.resolve(matches.shift() ?? null)
      },
      insertOne: (doc: Record<string, unknown>) => {
        audits.push(doc)

        return Promise.resolve({ acknowledged: true })
      },
    }),
  }),
})

const { computerStillShared, dropTeamUse } = await import('./conversation-computer-use')

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

describe('after removing someone from a chat, stopping their computer use is offered', () => {
  test('to the owner or a manager, when the person still uses it by name', async () => {
    const device = mac({ userIds: ['leo', 'maya'], managerIds: ['maya'] })

    for (const actor of ['owner', 'maya'])
      expect((await computerStillShared(chat, actor, 'leo', depsFor(device)))?.offer).toEqual({
        deviceId: 'mac',
        label: 'Owner’s Mac',
      })
  })

  test('not to someone who only uses the computer themselves', async () => {
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
})

describe('stopping one person’s use', () => {
  test('pulls only them, in one guarded update, and is audited', async () => {
    calls.length = 0
    audits.length = 0
    matches = [mac({ userIds: ['leo', 'maya'], managerIds: ['priya'] })]
    const by = { actorUserId: 'owner', via: 'conversation_remove' as const }

    expect(await dropTeamUse(mac({}), TEAM, 'leo', by)).toBe(true)
    expect(calls[0]).toEqual({
      filter: {
        userId: 'owner',
        deviceId: 'mac',
        access: {
          $elemMatch: { teamId: TEAM, everyone: false, userIds: 'leo', managerIds: { $ne: 'leo' } },
        },
      },
      update: { $pull: { 'access.$[grant].userIds': 'leo' } },
      options: { returnDocument: 'before', arrayFilters: [{ 'grant.teamId': TEAM }] },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actorUserId: 'owner',
      via: 'conversation_remove',
      previous: { everyone: false, userIds: ['leo', 'maya'], managerIds: ['priya'] },
      next: { everyone: false, userIds: ['maya'], managerIds: ['priya'] },
    })
  })

  test('changes nothing when they are no longer on it by name', async () => {
    audits.length = 0
    matches = []
    expect(
      await dropTeamUse(mac({}), TEAM, 'leo', { actorUserId: 'owner', via: 'conversation_remove' }),
    ).toBe(false)
    expect(audits).toHaveLength(0)
  })
})
