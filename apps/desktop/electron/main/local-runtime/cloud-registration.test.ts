import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-runtime-'))

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
process.env.NUPHOS_API_URL = 'http://127.0.0.1:3718'
process.env.NUPHOS_LOCAL_RUNTIME_DIR = path.join(dir, 'unbundled')
delete process.env.ATLAS_API_URL
const requests: string[] = []
const sockets: string[] = []
let stopped = 0
let connectBackend: (() => unknown) | undefined

mock.module('electron', {
  namedExports: {
    app: { isPackaged: false, getPath: () => dir, getVersion: () => 'test' },
    BrowserWindow: { getAllWindows: () => [] },
    powerMonitor: { on: () => {} },
    shell: {},
  },
})
mock.module('../env.ts', { namedExports: { isDev: true } })
mock.module('../device-identity.ts', {
  namedExports: {
    readDeviceIdentity: () => ({ deviceId: 'dev-device', label: 'M5', createdAt: '' }),
    setDeviceLabel: () => {
      throw new Error('not used')
    },
  },
})
mock.module('../../agent/http.ts', {
  namedExports: {
    callJson: async (_method: string, route: string) => {
      requests.push(route)
    },
  },
})
mock.module('../../agent/local-exec.ts', {
  namedExports: { logLocalTool: () => {}, normalizeToolError: String },
})
mock.module('../../agent/dock-terminal.ts', {
  namedExports: { createDockTerminalStream: () => {} },
})
mock.module('./cua-stream.ts', {
  namedExports: { localToolStreams: {}, fitFrame: (value: unknown) => value },
})
mock.module('./browser-tabs.ts', { namedExports: { runBrowserCall: () => {} } })
mock.module('./mac-screen.ts', {
  namedExports: { enableMacScreen: () => null, macScreenDeps: () => ({}) },
})
mock.module('./sleep-prevention-electron.ts', {
  namedExports: {
    initSleepPrevention: () => {},
    stopSleepPrevention: () => {},
    sleepState: () => ({}),
    taskActivity: {},
  },
})
mock.module('./tunnel-client.ts', {
  namedExports: {
    RuntimeTunnelClient: class {
      constructor(deps: { connectBackend: () => unknown }) {
        connectBackend = deps.connectBackend
      }
      start() {
        connectBackend?.()
      }
      stop() {
        stopped += 1
      }
      sendStatus() {}
      reconnectNow() {
        connectBackend?.()
      }
    },
  },
})
mock.method(globalThis, 'WebSocket', function (url: string) {
  sockets.push(url)
})

const { setApiUrl } = await import('../../api-endpoint.ts')
const { authSession } = await import('../../auth-session.ts')
const { initLocalRuntime, getLocalRuntimeState, stopLocalRuntime } = await import('./index.ts')
const token = `test.${Buffer.from(JSON.stringify({ sub: 'alice' })).toString('base64url')}.test`
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5))
}
// The first registration reads the Mac model, which can take seconds on a CI runner.
const until = async (done: () => boolean) => {
  for (let i = 0; i < 1000 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
}

after(async () => {
  await stopLocalRuntime()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('Cloud sign-in stays usable without registering a dev device or opening its tunnel', async () => {
  setApiUrl('https://api.nuphos.ai')
  authSession.set(token)
  initLocalRuntime()
  await settle()
  assert.equal(authSession.current(), token)
  assert.equal(getLocalRuntimeState().userId, null)
  assert.deepEqual(requests, [])
  assert.deepEqual(sockets, [])
})

test('switching endpoints stops hosting on Cloud and resumes on the dev backend', async () => {
  setApiUrl(null)
  await until(() => sockets.length === 1)
  assert.equal(getLocalRuntimeState().userId, 'alice')
  assert.deepEqual(requests, ['/agent/devices'])
  assert.deepEqual(sockets, ['ws://127.0.0.1:3718/agent/devices/dev-device/runtime-tunnel'])
  setApiUrl('https://api.nuphos.ai')
  await settle()
  assert.equal(getLocalRuntimeState().userId, null)
  assert.ok(stopped > 0)
  assert.throws(() => connectBackend?.(), /do not register computers with Nuphos Cloud/u)
  assert.equal(requests.length, 1)
  assert.equal(sockets.length, 1)
  assert.equal(authSession.current(), token)
  setApiUrl(null)
  await until(() => sockets.length === 2)
  assert.equal(getLocalRuntimeState().userId, 'alice')
  assert.equal(requests.length, 2)
  assert.equal(sockets.length, 2)
})

test('switching between two allowed backends with the same account moves hosting to the new one', async () => {
  const stops = stopped

  setApiUrl('http://127.0.0.1:3719')
  await until(() => sockets.length === 3)
  assert.ok(stopped > stops)
  assert.equal(getLocalRuntimeState().userId, 'alice')
  assert.equal(requests.length, 3)
  assert.equal(sockets[2], 'ws://127.0.0.1:3719/agent/devices/dev-device/runtime-tunnel')
  assert.equal(authSession.current(), token)
})
