import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, mock, test } from 'node:test'

import type * as CrashReporter from './crash-reporter.ts'

type StartOptions = {
  submitURL: string
  uploadToServer: boolean
  compress: boolean
  rateLimit: boolean
  globalExtra: Record<string, string>
}

const noop = () => {}
const userData = mkdtempSync(path.join(tmpdir(), 'crash-reporter-'))
const settingFile = path.join(userData, 'diagnostics.json')
let started: StartOptions | undefined
let analytics: boolean[] = []
let broadcasts: unknown[][] = []
let syncHandler: ((event: { returnValue?: unknown }) => void) | undefined
const extra = new Map<string, string>()

type CrashReporterModule = typeof CrashReporter
// A fresh module instance per "launch", so state read at startup is re-read.
let launches = 0
const launch = async (): Promise<CrashReporterModule> => {
  const mod = (await import(
    `./crash-reporter.ts?launch=${String(++launches)}`
  )) as CrashReporterModule

  mod.watchCrashes()

  return mod
}
const syncValue = () => {
  const event: { returnValue?: unknown } = {}

  syncHandler?.(event)

  return event.returnValue
}

before(() => {
  delete process.env.VITE_DEV_SERVER_URL
  process.env.NUPHOS_API_URL = 'https://api.example.test'
  mock.module('electron', {
    namedExports: {
      app: { getPath: () => userData },
      BrowserWindow: {
        getAllWindows: () => [
          { webContents: { send: (...args: unknown[]) => broadcasts.push(args) } },
        ],
      },
      ipcMain: {
        on: (channel: string, handler: typeof syncHandler) => {
          if (channel === 'diagnostics:enabled') syncHandler = handler
        },
      },
      crashReporter: {
        start: (options: StartOptions) => {
          started = options
        },
        addExtraParameter: (key: string, value: string) => extra.set(key, value),
      },
    },
  })
  mock.module('./analytics.ts', {
    namedExports: {
      captureMainException: noop,
      setMainAnalyticsEnabled: (on: boolean) => analytics.push(on),
    },
  })
  mock.module('./main/device-identity.ts', {
    namedExports: { readDeviceIdentity: () => ({ deviceId: 'hardware-uuid-1234' }) },
  })
})

beforeEach(() => {
  started = undefined
  analytics = []
  broadcasts = []
  extra.clear()
})

test('uploads plain minidumps to the backend with non-identifying annotations', async () => {
  await launch()

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

test('the setting defaults on; turning it off stops analytics and flags later crashes', async () => {
  const { setSendDiagnostics } = await launch()

  assert.deepEqual(analytics, [true])
  assert.equal(extra.get('upload_off'), undefined)
  assert.equal(syncValue(), true)

  assert.equal(setSendDiagnostics(false), false)
  assert.equal(extra.get('upload_off'), '1')
  assert.deepEqual(analytics, [true, false])
  assert.deepEqual(broadcasts, [['diagnostics:changed', false]])
  assert.equal(syncValue(), false)
  assert.deepEqual(JSON.parse(readFileSync(settingFile, 'utf8')), { send: false })
  assert.throws(() => setSendDiagnostics('no'))
})

test('a saved opt-out keeps uploads and analytics off from launch', async () => {
  writeFileSync(settingFile, JSON.stringify({ send: false }))
  await launch()

  assert.equal(started?.uploadToServer, false)
  assert.deepEqual(analytics, [false])
  assert.equal(syncValue(), false)
})
