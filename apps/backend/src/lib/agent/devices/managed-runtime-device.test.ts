// Run with: cd apps/backend && bun test src/lib/agent/devices/managed-runtime-device.test.ts

import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

let store = portabilityDb()

useDb({ db: () => ({ collection: (name: string) => store.collection(name) }) })

const {
  claimBoxAgentDevice,
  teamOrderingVcpus,
  insertBoxAgentDevice,
  insertManagedRuntimeDevice,
  listTeamBoxes,
} = await import('./store')

beforeEach(() => {
  store = portabilityDb()
})

describe('the device a managed runtime joins as', () => {
  test('belongs to the team and is usable by all of it', async () => {
    const device = await insertManagedRuntimeDevice('admin-1', {
      deviceId: 'pod-device',
      label: 'Fong (6.25x)',
      teamId: 'team-1',
    })

    expect(device.box).toEqual({
      provider: 'k8s',
      teamId: 'team-1',
      createdBy: 'admin-1',
      access: { everyone: true, userIds: [] },
    })
    expect(device.allowLocalExec).toBe(false)
  })

  test('is reached through its runtime, never listed or counted as one of the team’s Boxes', async () => {
    await insertManagedRuntimeDevice('admin-1', {
      deviceId: 'pod-device',
      label: 'runtime',
      teamId: 'team-1',
    })
    await insertBoxAgentDevice('admin-1', {
      deviceId: 'box-device',
      label: 'Box',
      platform: 'linux',
      allowLocalExec: true,
      box: { provider: 'instabox', teamId: 'team-1', vcpus: 2 },
    })

    expect((await listTeamBoxes('team-1')).map((device) => device.deviceId)).toEqual(['box-device'])
    expect(await teamOrderingVcpus('team-1')).toBe(2)
  })

  test('is claimed once by the join token minted for it', async () => {
    await insertManagedRuntimeDevice('admin-1', {
      deviceId: 'pod-device',
      label: 'runtime',
      teamId: 'team-1',
    })

    expect(await claimBoxAgentDevice('admin-1', 'pod-device', 'linux', 'hash-1')).toBe(true)
    expect(await claimBoxAgentDevice('admin-1', 'pod-device', 'linux', 'hash-2')).toBe(false)
  })
})
