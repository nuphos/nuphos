import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { RuntimeInstance } from '../types/runtime.ts'

let instances: RuntimeInstance[] = []
let quotaReads = 0

mock.module('../api.ts', {
  namedExports: {
    api: {
      atlasListRuntimeInstances: async () => instances,
      atlasListRuntimeQuotas: async () => {
        quotaReads += 1

        return []
      },
    },
  },
})
const { subscribePoll } = await import('./sharedPoll.ts')
const { loadInstances, runtimeQuotasKey } = await import('./useRuntimeInstances.ts')
const { api } = await import('../api.ts')

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('re-reads usage once when an agent or its first reading arrives after launch', async () => {
  mock.method(globalThis, 'setInterval', () => 1 as unknown as ReturnType<typeof setInterval>)
  mock.method(globalThis, 'clearInterval', () => {})
  const stop = subscribePoll(
    runtimeQuotasKey('team'),
    () => api.atlasListRuntimeQuotas('team'),
    30_000,
    () => {},
  )

  try {
    await settle()
    assert.equal(quotaReads, 1)
    await loadInstances('team')
    await settle()
    assert.equal(quotaReads, 1, 'the first agent list only records presence')
    const agent: RuntimeInstance = {
      id: 'local-codex',
      provider: 'codex',
      kind: 'local',
      status: 'active',
      label: 'Codex',
      createdAt: '',
      local: { ownerUserId: 'owner', deviceId: 'device', deviceLabel: 'Local', signedIn: true },
    }

    instances = [agent]
    await loadInstances('team')
    await settle()
    assert.equal(quotaReads, 2)
    instances = [{ ...agent }]
    await loadInstances('team')
    await settle()
    assert.equal(quotaReads, 2)
    instances = [{ ...agent, local: { ...agent.local!, usageAt: '2026-10-04T19:00:00Z' } }]
    await loadInstances('team')
    await settle()
    assert.equal(quotaReads, 3)
  } finally {
    stop()
    mock.restoreAll()
  }
})
