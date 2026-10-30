import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'
import type { SocketLike } from './tunnel-client.ts'

let deps: LocalRuntimeControllerDeps
const sample = {
  sampledAt: '2026-10-22T00:00:00Z',
  cpuPercent: 25,
  memory: { used: 1, total: 2 },
  disk: { used: 1, total: 3 },
}
let samples = 0
const noop = () => {}

// Load the actual Desktop entry point, replacing OS/app boundaries. The tunnel
// and its metrics lease stay real so omitting the sampler reproduces the bug.
/* eslint-disable @typescript-eslint/no-extraneous-class -- Constructor-only mocks for Desktop startup. */
const boundaries: Record<string, Record<string, unknown>> = {
  electron: {
    app: { getPath: () => '/tmp', getAppPath: () => '/tmp', isPackaged: false },
    BrowserWindow: {},
    powerMonitor: {},
    shell: {},
  },
  '../../agent/dock-terminal.ts': { createDockTerminalStream: noop },
  '../../agent/http.ts': { callJson: noop },
  '../../agent/local-exec.ts': { logLocalTool: noop },
  '../../api-endpoint.ts': {
    apiUrl: () => 'https://example.test',
    deviceRegistrationAllowed: () => true,
  },
  '../../auth-session.ts': {
    authSession: {
      context: () => ({ api: 'https://example.test', token: 'test-token', userId: 'u1' }),
    },
  },
  '../../auth-status.ts': { unverifiedTokenSubject: noop },
  '../../client-version.ts': { CLIENT_VERSION_HEADER: 'x-test', CLIENT_VERSION_VALUE: 'test' },
  '../../shell-env.ts': { resolveShellEnv: noop },
  '../device-controller.ts': { syncDeviceRegistration: noop },
  '../device-identity.ts': { readDeviceIdentity: () => ({ deviceId: 'test-device' }) },
  '../device-metrics.ts': {
    readDeviceMetrics: async () => {
      samples += 1

      return sample
    },
  },
  '../env.ts': { isDev: false },
  './agent-cli.ts': {
    LOCAL_AGENT_PROVIDERS: [],
    findAgentCli: noop,
    probeAgentCli: noop,
    readAgentUsage: noop,
  },
  './agent-home.ts': { prepareAgentHome: noop },
  './agent-login.ts': { LocalAgentLogin: class {} },
  './attachment-stream.ts': { localFileConnectors: () => ({}) },
  './browser-stream.ts': { LocalBrowserStream: class {} },
  './browser-tabs.ts': { runBrowserCall: noop },
  './cli-cache.ts': { readCliCache: noop, writeCliCache: noop },
  './config.ts': { agentCliEnv: noop, agentEnv: noop, readBundle: noop },
  './controller.ts': {
    LocalRuntimeController: class {
      constructor(value: LocalRuntimeControllerDeps) {
        deps = value
      }
    },
  },
  './cua-stream.ts': { localToolStreams: {} },
  './dev-bundle.ts': { devBundleHint: noop, watchDevBundle: noop },
  './mac-screen-app.ts': {
    macScreenApp: () => ({ deps: () => ({}), state: () => ({}), set: () => false }),
  },
  './model-probe.ts': { probeLocalModels: noop },
  './openab-process.ts': { OpenabProcess: class {} },
  './sleep-prevention-electron.ts': {},
}

for (const [name, namedExports] of Object.entries(boundaries)) mock.module(name, { namedExports })
/* eslint-enable @typescript-eslint/no-extraneous-class */
await import('./index.ts')

test('Desktop advertises metrics and sends them as soon as it connects', async (t) => {
  const frames: { t: string; status?: { localMetrics?: boolean }; metrics?: typeof sample }[] = []
  const listeners = new Map<string, (event: { data?: string }) => void>()

  class Socket implements SocketLike {
    readyState = 1
    send(raw: string) {
      frames.push(JSON.parse(raw))
    }
    close() {
      this.readyState = 3
    }
    addEventListener(name: string, listener: (event: { data?: string }) => void) {
      listeners.set(name, listener)
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')

  Object.defineProperty(globalThis, 'WebSocket', { value: Socket, configurable: true })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'WebSocket', original)
    else Reflect.deleteProperty(globalThis, 'WebSocket')
  })
  const tunnel = deps.createTunnel(
    () => null,
    () => ({ agents: {} }),
    noop,
    async () => ({}),
  )

  try {
    tunnel.start()
    listeners.get('open')?.({})
    assert.equal(frames.find((frame) => frame.t === 'status')?.status?.localMetrics, true)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(samples, 1)
    assert.deepEqual(frames.find((frame) => frame.t === 'metrics')?.metrics, sample)
  } finally {
    tunnel.stop()
  }
})
