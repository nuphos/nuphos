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
mock.module('./browser-streams.ts', { namedExports: { browserStreams: {} } })
mock.module('./mac-screen-app.ts', {
  namedExports: { macScreenApp: () => ({ deps: () => ({}) }) },
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
const token = 'nus_alice-session'
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
  authSession.set(token, 'alice')
  initLocalRuntime()
  await settle()
  assert.equal(authSession.current(), token)
  assert.equal(getLocalRuntimeState().userId, null)
  assert.deepEqual(requests, [])
  assert.deepEqual(sockets, [])
})

test('switching endpoints ends the session, so hosting stops until a sign-in on the new backend', async () => {
  setApiUrl(null)
  await settle()
  assert.equal(authSession.current(), null, 'a Cloud token is never sent to the dev backend')
  assert.deepEqual(requests, [])
  authSession.set(token, 'alice')
  await until(() => sockets.length === 1)
  assert.equal(getLocalRuntimeState().userId, 'alice')
  assert.deepEqual(requests, ['/agent/devices'])
  assert.deepEqual(sockets, ['ws://127.0.0.1:3718/agent/devices/dev-device/runtime-tunnel'])
  setApiUrl('https://api.nuphos.ai')
  await settle()
  assert.equal(getLocalRuntimeState().userId, null)
  assert.ok(stopped > 0)
  assert.equal(authSession.current(), null)
  assert.throws(() => connectBackend?.(), /do not register computers with Nuphos Cloud/u)
  assert.equal(requests.length, 1)
  assert.equal(sockets.length, 1)
})

test('another allowed backend hosts only after signing in there', async () => {
  setApiUrl('http://127.0.0.1:3718')
  authSession.set(token, 'alice')
  await until(() => sockets.length === 2)
  const stops = stopped

  setApiUrl('http://127.0.0.1:3719')
  await settle()
  assert.ok(stopped > stops)
  assert.equal(getLocalRuntimeState().userId, null)
  assert.equal(sockets.length, 2)
  authSession.set('nus_alice-on-3719', 'alice')
  await until(() => sockets.length === 3)
  assert.equal(getLocalRuntimeState().userId, 'alice')
  assert.equal(requests.length, 3)
  assert.equal(sockets[2], 'ws://127.0.0.1:3719/agent/devices/dev-device/runtime-tunnel')
})
