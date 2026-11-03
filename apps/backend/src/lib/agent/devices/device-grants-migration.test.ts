import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type { AgentDevice } from './store'

const updates: { filter: unknown; update: unknown }[] = []
let rows: unknown[] = []

useDb({
  db: () => ({
    collection: () => ({
      find: () => ({ toArray: () => Promise.resolve(rows) }),
      updateOne: (filter: unknown, update: unknown) => {
        updates.push({ filter, update })

        return Promise.resolve({ matchedCount: 1 })
      },
    }),
  }),
})

const { legacyGrants, migrateDeviceAccessGrants } = await import('./device-grants-migration')

const base = {
  userId: 'owner',
  deviceId: 'mac',
  label: 'Mac',
  platform: 'darwin',
  allowLocalExec: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}
const cloud = (deviceId: string) => ({
  ...base,
  deviceId,
  box: { provider: 'instabox', teamId: 't' },
})
const deps = { adminIds: () => Promise.resolve(['admin', 'creator']) }

test('a share at any level becomes use; nobody manages a person’s computer but its owner', async () => {
  const device = {
    ...base,
    shares: [
      { teamId: 'a', level: 'approve', everyone: false, userIds: ['mate'] },
      { teamId: 'b', level: 'full', everyone: true, userIds: [] },
    ],
  } as AgentDevice

  expect(await legacyGrants(device, deps)).toEqual([
    { teamId: 'a', everyone: false, userIds: ['mate'], managerIds: [] },
    { teamId: 'b', everyone: true, userIds: [], managerIds: [] },
  ])
})

test('a cloud computer keeps its users; its team’s admins become managers, never its owner', async () => {
  const device = {
    ...base,
    box: {
      provider: 'instabox',
      teamId: 't',
      createdBy: 'creator',
      access: { everyone: false, userIds: ['creator', 'mate'] },
    },
  } as AgentDevice

  expect(await legacyGrants(device, deps)).toEqual([
    { teamId: 't', everyone: false, userIds: ['mate'], managerIds: ['admin'] },
  ])
  // Without a list it was its creator's alone; a managed runtime's pod stays usable by all.
  const bare = { ...base, box: { provider: 'instabox', teamId: 't' } } as AgentDevice
  const pod = {
    ...base,
    box: { provider: 'k8s', teamId: 't', access: { everyone: true, userIds: [] } },
  } as AgentDevice

  expect((await legacyGrants(bare, deps))[0]).toMatchObject({ everyone: false, userIds: [] })
  expect((await legacyGrants(pod, deps))[0]).toEqual({
    teamId: 't',
    everyone: true,
    userIds: [],
    managerIds: [],
  })
})

test('migrating writes grants only where there are none, and keeps the old fields for a rollback', async () => {
  rows = [{ ...base, box: { provider: 'instabox', teamId: 't' } }]
  updates.length = 0

  expect(await migrateDeviceAccessGrants(deps)).toBe(1)
  expect(updates[0]).toEqual({
    filter: { userId: 'owner', deviceId: 'mac', access: { $exists: false } },
    update: {
      $set: {
        access: [{ teamId: 't', everyone: false, userIds: [], managerIds: ['admin', 'creator'] }],
        'box.createdBy': 'owner',
      },
    },
  })
})

test('each team’s administrators are read once', async () => {
  let reads = 0

  rows = [cloud('a'), cloud('b')]
  await migrateDeviceAccessGrants({
    adminIds: () => {
      reads++

      return Promise.resolve([])
    },
  })
  expect(reads).toBe(1)
})
