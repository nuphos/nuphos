import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { RuntimeInstance } from '../types/runtime.ts'

let dependencies: unknown[] | undefined
let cleanup: (() => void) | undefined
let calls = 0

mock.module('../api.ts', {
  namedExports: {
    api: {
      atlasListRuntimeQuotas: async () => {
        calls += 1

        return []
      },
    },
  },
})
mock.module('./useRuntimeInstances.ts', {
  namedExports: { RUNTIME_INSTANCES_CHANGED: 'instances-changed' },
})
mock.module('react', {
  namedExports: {
    useState: () => [{ quotas: new Map() }, () => {}],
    useEffect: (effect: () => (() => void) | undefined, next: unknown[]) => {
      if (dependencies && next.every((value, index) => Object.is(value, dependencies![index])))
        return
      cleanup?.()
      dependencies = next
      cleanup = effect()
    },
  },
})
const { useRuntimeQuotas } = await import('./useRuntimeQuotas.ts')

function render(instances: RuntimeInstance[]) {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Mocked React effect scheduler.
  useRuntimeQuotas('team', instances)
}

test('refreshes usage when an agent and its first reading arrive after app launch', async () => {
  const events = new EventTarget()

  mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>)
  mock.method(globalThis, 'clearInterval', () => {})
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events })
  try {
    render([])
    assert.equal(calls, 1)
    const agent: RuntimeInstance = {
      id: 'local-codex',
      provider: 'codex',
      kind: 'local',
      status: 'active',
      label: 'Codex',
      createdAt: '',
      local: {
        ownerUserId: 'owner',
        deviceId: 'device',
        deviceLabel: 'Local',
        signedIn: true,
      },
    }

    render([agent])
    assert.equal(calls, 2)
    render([{ ...agent }])
    assert.equal(calls, 2)
    render([{ ...agent, local: { ...agent.local!, usageAt: '2026-10-04T19:00:00Z' } }])
    assert.equal(calls, 3)
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    cleanup?.()
    mock.restoreAll()
    Reflect.deleteProperty(globalThis, 'window')
  }
})
