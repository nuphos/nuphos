import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LocalRuntimeController } from './controller.ts'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

for (const next of ['alice', 'bob', null, 'roundtrip']) {
  test(`a pending registration reconciles the latest request for ${String(next)}`, async () => {
    const entered = deferred()
    const registration = deferred()
    const tunnels: (string | null)[] = []
    let calls = 0
    const deps: LocalRuntimeControllerDeps = {
      backendUrl: 'http://localhost:3718',
      bundle: () => null,
      dataDir: () => '/data/runtime-switch-test',
      nodeExecPath: process.execPath,
      userEnv: async () => ({}),
      probeCli: async () => ({ installed: false }),
      readUsage: async () => {},
      readCliCache: () => ({}),
      writeCliCache: () => {},
      prepareAgentHome: () => undefined,
      probeModels: async () => ({ models: [], defaultModel: '', controls: {} }),
      createProcess: () => {
        throw new Error('No agent should start')
      },
      registerDevice: async () => {
        if (++calls !== 1) return
        entered.resolve()
        await registration.promise
      },
      createTunnel: () => ({
        start: () => {
          tunnels.push(controller.state().userId)
        },
        stop: () => {},
        sendStatus: () => {},
        reconnectNow: () => {},
      }),
    }
    const controller = new LocalRuntimeController(deps, [], true)
    const first = controller.setUser('alice')

    await entered.promise
    const target = next === 'roundtrip' ? 'alice' : next
    const intermediate = next === 'roundtrip' ? controller.setUser('bob') : Promise.resolve()
    const second = controller.setUser(target)

    registration.resolve()
    await Promise.all([first, intermediate, second])
    assert.deepEqual(tunnels, target ? [target] : [])
    assert.equal(controller.state().userId, target)
    await controller.shutdown()
  })
}
