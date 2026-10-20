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

for (const next of ['bob', null]) {
  test(`a pending registration cannot open an obsolete tunnel after switching to ${String(next)}`, async () => {
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
    const second = controller.setUser(next)

    registration.resolve()
    await Promise.all([first, second])
    assert.deepEqual(tunnels, next ? [next] : [])
    assert.equal(controller.state().userId, next)
    await controller.shutdown()
  })
}
