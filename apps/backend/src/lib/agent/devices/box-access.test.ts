import { expect, test } from 'bun:test'

import {
  allows,
  deviceAccess,
  listAccessibleDevices,
  losingUse,
  requireDeviceAccess,
} from './box-access'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice, DeviceGrant } from './store'

const grant = (over: Partial<DeviceGrant> = {}): DeviceGrant => ({
  teamId: 't1',
  everyone: false,
  userIds: [],
  managerIds: [],
  ...over,
})
const box: AgentDevice = {
  userId: 'host',
  deviceId: 'b1',
  label: 'Box',
  platform: 'linux',
  allowLocalExec: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  box: { provider: 'instabox', teamId: 't1', createdBy: 'creator' },
  access: [grant({ userIds: ['mate'], managerIds: ['lead'] })],
}
const laptop: AgentDevice = {
  userId: 'owner',
  deviceId: 'mac',
  label: 'Mac mini',
  platform: 'darwin',
  allowLocalExec: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  access: [grant({ userIds: ['mate'], managerIds: ['lead'] })],
}
const deps = (
  devices: { boxes?: AgentDevice[]; granted?: AgentDevice[]; own?: AgentDevice[] },
  members: string[] = ['creator', 'owner', 'mate', 'lead', 'admin'],
): DeviceAccessDeps => ({
  getDevice: (owner, id) =>
    Promise.resolve(
      (devices.own ?? []).find((d) => d.userId === owner && d.deviceId === id) ?? null,
    ),
  listDevices: (owner) => Promise.resolve((devices.own ?? []).filter((d) => d.userId === owner)),
  listBoxes: (team) => Promise.resolve(team === 't1' ? (devices.boxes ?? []) : []),
  listGranted: (team) => Promise.resolve(team === 't1' ? (devices.granted ?? []) : []),
  findGranted: (team, id) =>
    Promise.resolve(team === 't1' ? (devices.granted ?? []).filter((d) => d.deviceId === id) : []),
  // Roles confer nothing on a computer; only membership counts.
  role: (actor, team) =>
    Promise.resolve(team === 't1' && members.includes(actor) ? 'EDITOR' : null),
})

test('the owner, then the grant: managers manage, the rest it names use, roles confer nothing', () => {
  expect(deviceAccess(box, 'creator', 't1')).toBe('owner')
  expect(deviceAccess(box, 'lead', 't1')).toBe('manage')
  expect(deviceAccess(box, 'mate', 't1')).toBe('use')
  expect(deviceAccess(box, 'admin', 't1')).toBeNull()
  // The transport owner is not the owner once the computer has passed to someone else.
  expect(deviceAccess(box, 'host', 't1')).toBeNull()
  expect(deviceAccess(laptop, 'owner', undefined)).toBe('owner')
  expect(deviceAccess(laptop, 'mate', 't1')).toBe('use')
  expect(deviceAccess(laptop, 'mate', 't2')).toBeNull()
  expect(deviceAccess({ ...laptop, access: [grant({ everyone: true })] }, 'x', 't1')).toBe('use')
})

test('a cloud computer counts only in its own team, even for its owner', () => {
  expect(deviceAccess(box, 'creator', 't2')).toBeNull()
  expect(deviceAccess(box, 'mate', undefined)).toBeNull()
})

test('each level allows what is below it', () => {
  expect(allows('owner', 'manage')).toBe(true)
  expect(allows('manage', 'use')).toBe(true)
  expect(allows('manage', 'owner')).toBe(false)
  expect(allows('use', 'manage')).toBe(false)
  expect(allows(null, 'use')).toBe(false)
})

test('a teammate uses a computer granted to them, everything but managing it', async () => {
  const d = deps({ granted: [laptop] })

  expect(await requireDeviceAccess('mate', 't1', 'mac', 'use', d)).toBe(laptop)
  expect(await requireDeviceAccess('lead', 't1', 'mac', 'manage', d)).toBe(laptop)
  await expect(requireDeviceAccess('mate', 't1', 'mac', 'manage', d)).rejects.toMatchObject({
    status: 404,
  })
  await expect(requireDeviceAccess('lead', 't1', 'mac', 'owner', d)).rejects.toMatchObject({
    status: 404,
  })
  expect((await listAccessibleDevices('mate', 't1', d)).map((x) => x.deviceId)).toEqual(['mac'])
})

test('nothing of a teammate’s computer is left once its owner or the viewer leaves the team', async () => {
  const ownerGone = deps({ granted: [laptop] }, ['mate', 'lead'])
  const mateGone = deps({ granted: [laptop] }, ['owner', 'lead'])

  await expect(requireDeviceAccess('mate', 't1', 'mac', 'use', ownerGone)).rejects.toMatchObject({
    status: 404,
  })
  expect(await listAccessibleDevices('mate', 't1', ownerGone)).toEqual([])
  await expect(requireDeviceAccess('mate', 't1', 'mac', 'use', mateGone)).rejects.toMatchObject({
    status: 404,
  })
})

test('a cloud computer stays with its team: its owner and grant decide, admins get nothing', async () => {
  const d = deps({ boxes: [box] })

  expect(await requireDeviceAccess('creator', 't1', 'b1', 'owner', d)).toBe(box)
  expect(await requireDeviceAccess('lead', 't1', 'b1', 'manage', d)).toBe(box)
  expect(await requireDeviceAccess('mate', 't1', 'b1', 'use', d)).toBe(box)
  for (const actor of ['admin', 'stranger'])
    await expect(requireDeviceAccess(actor, 't1', 'b1', 'use', d)).rejects.toMatchObject({
      status: 404,
    })
  await expect(requireDeviceAccess('creator', 't2', 'b1', 'use', d)).rejects.toMatchObject({
    status: 404,
  })
})

test('ambiguous device IDs in the same team fail closed rather than selecting an owner', async () => {
  const d = deps({ boxes: [box, { ...box, userId: 'other-host' }] })

  await expect(requireDeviceAccess('creator', 't1', 'b1', 'use', d)).rejects.toMatchObject({
    status: 404,
  })
})

test('asking for your own Box without its team is a 400, not an empty answer', async () => {
  const own = { ...box, userId: 'creator' }

  await expect(
    requireDeviceAccess('creator', undefined, 'b1', 'use', deps({ own: [own], boxes: [own] })),
  ).rejects.toMatchObject({ status: 400, code: 'team_required' })
})

test('losing use spares the owner, managers and whoever stays on the list', () => {
  const members = ['creator', 'lead', 'mate', 'other']

  expect(losingUse(members, box, 't1', { everyone: false, userIds: ['mate'] })).toEqual(['other'])
  expect(losingUse(members, box, 't1', { everyone: false, userIds: [] })).toEqual(['mate', 'other'])
  expect(losingUse(members, box, 't1', { everyone: true, userIds: [] })).toEqual([])
})
