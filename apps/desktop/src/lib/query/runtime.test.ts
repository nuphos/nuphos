import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { QueryObserver } from '@tanstack/react-query'

import type { RuntimeInstance } from '../../types/runtime.ts'

let instances: RuntimeInstance[] = []
const reads: string[] = []

mock.module('../../api.ts', {
  namedExports: {
    api: {
      atlasListRuntimeInstances: async (teamId: string) => {
        reads.push(`instances:${teamId}`)

        return instances
      },
      atlasListRuntimeQuotas: async (teamId: string) => {
        reads.push(`quotas:${teamId}`)

        return [{ runtimeId: 'a' }]
      },
    },
  },
})
const { createQueryClient } = await import('./client.ts')
const { refreshRuntimeLists, runtimeInstancesQuery, runtimeQuotasQuery } =
  await import('./runtime.ts')
const { queryKeys } = await import('./keys.ts')

const settle = () => new Promise((resolve) => setImmediate(resolve))
const recordRead = (name: string) => async () => reads.push(name)
const count = (prefix: string) => reads.filter((read) => read.startsWith(prefix)).length

function watch(client: ReturnType<typeof createQueryClient>, options: object) {
  const observer = new QueryObserver(client, options)

  return observer.subscribe(() => {})
}

const local = { ownerUserId: 'owner', deviceId: 'device', deviceLabel: 'Local', signedIn: true }
const agent: RuntimeInstance = {
  id: 'local-codex',
  provider: 'codex',
  kind: 'local',
  status: 'active',
  label: 'Codex',
  createdAt: '',
  local,
}

test('re-reads usage once when an agent or its first reading arrives after launch', async () => {
  reads.length = 0
  instances = []
  const client = createQueryClient()
  const stop = watch(client, runtimeQuotasQuery('team'))
  const list = () => client.fetchQuery({ ...runtimeInstancesQuery('team'), staleTime: 0 })

  try {
    await settle()
    assert.equal(count('quotas'), 1)
    await list()
    await settle()
    assert.equal(count('quotas'), 1, 'the first agent list only records presence')
    instances = [agent]
    await list()
    await settle()
    assert.equal(count('quotas'), 2)
    instances = [{ ...agent }]
    await list()
    await settle()
    assert.equal(count('quotas'), 2)
    instances = [{ ...agent, local: { ...local, usageAt: '2026-10-04T19:00:00Z' } }]
    await list()
    await settle()
    assert.equal(count('quotas'), 3)
  } finally {
    stop()
  }
})

test('a change to the agents reads every shown team’s agents, usage and status, nothing else', async () => {
  reads.length = 0
  instances = []
  const client = createQueryClient()
  const stops = [
    watch(client, runtimeInstancesQuery('t1')),
    watch(client, runtimeQuotasQuery('t2')),
    watch(client, { queryKey: queryKeys.runtimeStatus('t1', 'a'), queryFn: recordRead('status') }),
    watch(client, {
      queryKey: queryKeys.runtimeMetrics('t1', 'a', 1),
      queryFn: recordRead('metrics'),
    }),
  ]

  await settle()
  reads.length = 0
  await refreshRuntimeLists(client)
  assert.deepEqual(reads.sort(), ['instances:t1', 'quotas:t2', 'status'])
  for (const stop of stops) stop()
})
