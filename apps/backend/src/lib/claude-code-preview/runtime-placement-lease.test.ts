import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { withRuntimePlacementLease } from './runtime-placement-lease'

import type { KubeClient } from './kube-client'

let memory = portabilityDb()

useDb({ db: () => memory })
beforeEach(() => {
  memory = portabilityDb()
})
test('a second controller cannot provision while deletion owns a placement', async () => {
  let entered = false

  await withRuntimePlacementLease('team', 'placement', {} as KubeClient, async () => {
    await withRuntimePlacementLease('team', 'placement', {} as KubeClient, async () => {
      entered = true
    })
  })
  expect(entered).toBe(false)
  expect(memory.rows('agent_runtime_placement_leases')).toHaveLength(0)
})
test('a worker that lost its lease cannot delete or release another worker’s lock', async () => {
  let deleted = false
  const kube = {
    delete: async () => {
      deleted = true
    },
  } as unknown as KubeClient

  await withRuntimePlacementLease('team', 'placement', kube, async (guarded) => {
    memory.rows('agent_runtime_placement_leases')[0]!.token = 'new-owner'
    await expect(
      guarded.delete({
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { namespace: 'runtime', name: 'home' },
      }),
    ).rejects.toThrow('lease expired')
  })
  expect(deleted).toBe(false)
  expect(memory.rows('agent_runtime_placement_leases')[0]!.token).toBe('new-owner')
})
