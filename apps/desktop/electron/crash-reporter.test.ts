import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

type StartOptions = {
  submitURL: string
  uploadToServer: boolean
  compress: boolean
  rateLimit: boolean
  globalExtra: Record<string, string>
}

const noop = () => {}
let started: StartOptions | undefined
const extra = new Map<string, string>()
let watchCrashes: () => void

before(async () => {
  delete process.env.VITE_DEV_SERVER_URL
  process.env.NUPHOS_API_URL = 'https://api.example.test'
  mock.module('electron', {
    namedExports: {
      crashReporter: {
        start: (options: StartOptions) => {
          started = options
        },
        addExtraParameter: (key: string, value: string) => extra.set(key, value),
      },
    },
  })
  mock.module('./analytics.ts', { namedExports: { captureMainException: noop } })
  mock.module('./main/device-identity.ts', {
    namedExports: { readDeviceIdentity: () => ({ deviceId: 'hardware-uuid-1234' }) },
  })
  ;({ watchCrashes } = await import('./crash-reporter.ts'))
})

test('uploads plain minidumps to the backend with non-identifying annotations', () => {
  watchCrashes()

  assert.equal(started?.submitURL, 'https://api.example.test/desktop/crash-reports')
  assert.equal(started?.uploadToServer, true)
  assert.equal(started?.compress, false)
  assert.equal(started?.rateLimit, true)
  assert.equal(started?.globalExtra.arch, process.arch)
  // A hash, never the raw device id.
  assert.match(started?.globalExtra.device ?? '', /^[a-f0-9]{32}$/)
  assert.ok(!JSON.stringify(started).includes('hardware-uuid-1234'))
  for (const key of ['heap_used_mb', 'heap_limit_mb', 'uptime_s']) {
    assert.match(extra.get(key) ?? '', /^\d+$/, key)
  }
})
