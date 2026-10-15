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
