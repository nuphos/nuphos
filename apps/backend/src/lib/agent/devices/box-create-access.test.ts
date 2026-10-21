import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { requireDeviceAccess } from './box-access'
import { insertBoxAgentDevice } from './store'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'
import type * as dbActual from '@/lib/db'

const rows: AgentDevice[] = []

useDb({
  db: (() => ({
    collection: () => ({
      insertOne: (row: AgentDevice) => {
        rows.push(row)

        return Promise.resolve({ acknowledged: true })
      },
    }),
  })) as unknown as typeof dbActual.db,
})

test('Box creation persists creator-only access and rejects unlisted, cross-team and removed creators', async () => {
  const created = await insertBoxAgentDevice('creator', {
    deviceId: 'box',
    label: 'New Box',
    platform: 'linux',
    allowLocalExec: true,
    box: {
      provider: 'instabox',
      teamId: 'team',
      createdBy: 'forged',
      access: { everyone: true, userIds: ['other'] },
    },
  })

  expect(rows).toEqual([created])
  expect(created.box).toEqual({
    provider: 'instabox',
    teamId: 'team',
    createdBy: 'creator',
    access: { everyone: false, userIds: ['creator'] },
  })
  let active = true
  const deps: DeviceAccessDeps = {
    getDevice: () => Promise.resolve(created),
    listDevices: () => Promise.resolve(rows),
    listBoxes: () => Promise.resolve(rows),
    role: () => Promise.resolve(active ? 'EDITOR' : null),
  }

  expect(await requireDeviceAccess('creator', 'team', 'box', 'use', deps)).toBe(created)
  await expect(requireDeviceAccess('other', 'team', 'box', 'use', deps)).rejects.toMatchObject({
    status: 404,
  })
  await expect(
    requireDeviceAccess('creator', 'another-team', 'box', 'use', deps),
  ).rejects.toMatchObject({ status: 404 })
  await expect(requireDeviceAccess('creator', 'team', 'box', 'manage', deps)).rejects.toMatchObject(
    { status: 404 },
  )
  active = false
  await expect(requireDeviceAccess('creator', 'team', 'box', 'use', deps)).rejects.toMatchObject({
    status: 404,
  })
})

test('Box creation shares with the requested members while keeping its creator, still ignoring the registration', async () => {
  const created = await insertBoxAgentDevice(
    'creator',
    {
      deviceId: 'shared-box',
      label: 'Shared Box',
      platform: 'linux',
      allowLocalExec: true,
      box: { provider: 'instabox', teamId: 'team', access: { everyone: true, userIds: ['x'] } },
    },
    { everyone: false, userIds: ['alice', 'creator'] },
  )

  expect(created.box?.access).toEqual({ everyone: false, userIds: ['creator', 'alice'] })
})
