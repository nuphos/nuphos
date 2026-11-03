import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { requireDeviceAccess } from './box-access'
import { insertBoxAgentDevice } from './store'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'
import type * as dbActual from '@/lib/db'

const rows: AgentDevice[] = []

useDb({
  db: () => ({
    collection: () => ({
      insertOne: (row: AgentDevice) => {
        rows.push(row)

        return Promise.resolve({ acknowledged: true })
      },
    }),
  }),
})

test('Box creation makes its creator the owner, and only while they stay in its team', async () => {
  const created = await insertBoxAgentDevice('creator', {
    deviceId: 'box',
    label: 'New Box',
    platform: 'linux',
    allowLocalExec: true,
    box: {
      provider: 'instabox',
      teamId: 'team',
      createdBy: 'forged',
    },
  })

  expect(rows).toEqual([created])
  expect(created.box).toEqual({ provider: 'instabox', teamId: 'team', createdBy: 'creator' })
  expect(created.access).toEqual([{ teamId: 'team', everyone: false, userIds: [], managerIds: [] }])
  let active = true
  const deps: DeviceAccessDeps = {
    getDevice: () => Promise.resolve(created),
    listDevices: () => Promise.resolve(rows),
    listBoxes: () => Promise.resolve(rows),
    listGranted: () => Promise.resolve([]),
    findGranted: () => Promise.resolve([]),
    role: () => Promise.resolve(active ? 'EDITOR' : null),
  }

  expect(await requireDeviceAccess('creator', 'team', 'box', 'use', deps)).toBe(created)
  await expect(requireDeviceAccess('other', 'team', 'box', 'use', deps)).rejects.toMatchObject({
    status: 404,
  })
  await expect(
    requireDeviceAccess('creator', 'another-team', 'box', 'use', deps),
  ).rejects.toMatchObject({ status: 404 })
  expect(await requireDeviceAccess('creator', 'team', 'box', 'owner', deps)).toBe(created)
  active = false
  await expect(requireDeviceAccess('creator', 'team', 'box', 'use', deps)).rejects.toMatchObject({
    status: 404,
  })
})

test('Box creation lets the requested members use it, besides its owner', async () => {
  const created = await insertBoxAgentDevice(
    'creator',
    {
      deviceId: 'shared-box',
      label: 'Shared Box',
      platform: 'linux',
      allowLocalExec: true,
      box: { provider: 'instabox', teamId: 'team' },
    },
    { everyone: false, userIds: ['alice', 'creator'] },
  )

  expect(created.access).toEqual([
    { teamId: 'team', everyone: false, userIds: ['alice'], managerIds: [] },
  ])
})
