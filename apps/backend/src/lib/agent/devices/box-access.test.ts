import { expect, test } from 'bun:test'

import { deviceAccess, requireDeviceAccess } from './box-access'

import type { AgentDevice } from './store'

const legacy: AgentDevice = {
  userId: 'host',
  deviceId: 'b1',
  label: 'Box',
  platform: 'linux',
  allowLocalExec: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  box: { provider: 'instabox', teamId: 't1' },
}

test('legacy use stays with the original creator; creator status never grants manage', () => {
  expect(deviceAccess(legacy, 'host', 't1', 'EDITOR')).toBe('use')
  expect(deviceAccess(legacy, 'other', 't1', 'EDITOR')).toBeNull()
  expect(deviceAccess(legacy, 'admin', 't1', 'ADMINISTRATOR')).toBe('manage')
  expect(deviceAccess(legacy, 'host', 't1', null)).toBeNull()
  expect(deviceAccess(legacy, 'admin', undefined, 'ADMINISTRATOR')).toBeNull()
  const revoked = {
    ...legacy,
    box: { ...legacy.box!, createdBy: 'host', access: { everyone: false, userIds: [] } },
  }

  expect(deviceAccess(revoked, 'host', 't1', 'EDITOR')).toBeNull()
})

test('ambiguous device IDs in the same team fail closed rather than selecting an owner', async () => {
  await expect(
    requireDeviceAccess('admin', 't1', 'b1', 'manage', {
      getDevice: async () => null,
      listDevices: async () => [],
      listBoxes: async () => [legacy, { ...legacy, userId: 'other-host' }],
      role: async () => 'ADMINISTRATOR',
    }),
  ).rejects.toMatchObject({ status: 404 })
})

test('asking for your own Box without its team is a 400, not an empty answer', async () => {
  await expect(
    requireDeviceAccess('host', undefined, 'b1', 'use', {
      getDevice: () => Promise.resolve(legacy),
      listDevices: () => Promise.resolve([legacy]),
      listBoxes: () => Promise.resolve([legacy]),
      role: () => Promise.resolve('EDITOR'),
    }),
  ).rejects.toMatchObject({ status: 400, code: 'team_required' })
})

test('a Box stays with its team after its creator leaves: admins manage, outsiders get nothing', async () => {
  const box: AgentDevice = {
    ...legacy,
    userId: 'creator',
    box: {
      provider: 'instabox',
      teamId: 't1',
      createdBy: 'creator',
      access: { everyone: false, userIds: ['creator', 'mate'] },
    },
  }
  // The creator has left t1; admin and mate remain.
  const roles: Record<string, 'ADMINISTRATOR' | 'EDITOR'> = {
    admin: 'ADMINISTRATOR',
    mate: 'EDITOR',
  }
  const deps = {
    getDevice: () => Promise.resolve(null),
    listDevices: () => Promise.resolve([]),
    listBoxes: (team: string) => Promise.resolve(team === 't1' ? [box] : []),
    role: (actor: string, team: string) =>
      Promise.resolve(team === 't1' ? (roles[actor] ?? null) : null),
  }

  expect(await requireDeviceAccess('admin', 't1', 'b1', 'manage', deps)).toBe(box)
  expect(await requireDeviceAccess('mate', 't1', 'b1', 'use', deps)).toBe(box)
  for (const actor of ['creator', 'stranger'])
    await expect(requireDeviceAccess(actor, 't1', 'b1', 'use', deps)).rejects.toMatchObject({
      status: 404,
    })
  await expect(requireDeviceAccess('admin', 't2', 'b1', 'use', deps)).rejects.toMatchObject({
    status: 404,
  })
})
