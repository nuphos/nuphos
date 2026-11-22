import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
let uploads = false
let started: StartOptions | undefined
let analytics: boolean[] = []
let broadcasts: unknown[][] = []
const syncHandlers = new Map<string, (event: { returnValue?: unknown }) => void>()
const CLOUD = 'https://api.nuphos.ai'
const SELF_HOSTED = 'https://api.example.test'
let setApiUrl: (url: string | null) => string
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
const syncValue = (channel = 'diagnostics:enabled') => {
  const event: { returnValue?: unknown } = {}

  syncHandlers.get(channel)?.(event)

  return event.returnValue
}

before(async () => {
  delete process.env.VITE_DEV_SERVER_URL
  process.env.NUPHOS_CLI_CONFIG = path.join(userData, 'cli.test.yaml')
  process.env.NUPHOS_API_URL = SELF_HOSTED
  mock.module('electron', {
    namedExports: {
      app: { getPath: () => userData },
      BrowserWindow: {
        getAllWindows: () => [
          { webContents: { send: (...args: unknown[]) => broadcasts.push(args) } },
        ],
      },
      ipcMain: {
        on: (channel: string, handler: (event: { returnValue?: unknown }) => void) => {
          syncHandlers.set(channel, handler)
        },
      },
      crashReporter: {
        start: (options: StartOptions) => {
          started = options
          uploads = options.uploadToServer
        },
        addExtraParameter: (key: string, value: string) => extra.set(key, value),
        setUploadToServer: (value: boolean) => {
          uploads = value
        },
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
  ;({ setApiUrl } = await import('./api-endpoint.ts'))
})

beforeEach(() => {
  rmSync(settingFile, { force: true })
  setApiUrl(SELF_HOSTED)
  started = undefined
  analytics = []
  broadcasts = []
  extra.clear()
})

test('uploads plain minidumps to the backend with non-identifying annotations', async () => {
  await launch()

  assert.equal(started?.submitURL, `${SELF_HOSTED}/desktop/crash-reports`)
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

test('a self-hosted backend gets crash reports and never starts usage analytics', async () => {
  const { setSendDiagnostics } = await launch()

  assert.equal(started?.submitURL, `${SELF_HOSTED}/desktop/crash-reports`)
  assert.equal(started?.uploadToServer, true)
  assert.deepEqual(analytics, [false])
  assert.equal(syncValue(), true, 'the setting itself is on')
  assert.equal(syncValue('diagnostics:usage'), false)

  // Saving the setting as on does not start it either.
  assert.equal(setSendDiagnostics(true), true)
  assert.deepEqual(analytics, [false, false])
  assert.deepEqual(broadcasts, [['diagnostics:changed', false]])
})

test('moving to a self-hosted backend stops usage analytics and disables crash uploads until restart', async () => {
  setApiUrl(CLOUD)
  await launch()
  assert.equal(started?.submitURL, `${CLOUD}/desktop/crash-reports`)
  assert.equal(analytics.at(-1), true)
  assert.equal(syncValue('diagnostics:usage'), true)

  // Stop uploads before a later crash can use the previous destination.
  setApiUrl(SELF_HOSTED)
  assert.equal(analytics.at(-1), false)
  assert.equal(syncValue('diagnostics:usage'), false)
  assert.deepEqual(broadcasts.at(-1), ['diagnostics:changed', false])
  assert.equal(uploads, false)

  setApiUrl(CLOUD)
  assert.equal(analytics.at(-1), true)
  assert.deepEqual(broadcasts.at(-1), ['diagnostics:changed', true])
  assert.equal(uploads, false)
})

test('the setting defaults on; turning it off stops analytics and crash uploads', async () => {
  setApiUrl(CLOUD)
  // Earlier launches are still subscribed to the backend and have flagged their own Crashpad.
  extra.clear()
  const { setSendDiagnostics } = await launch()

  assert.equal(syncValue('diagnostics:usage'), true)

  assert.equal(analytics.at(-1), true)
  assert.equal(extra.get('upload_off'), undefined)
  assert.equal(syncValue(), true)

  assert.equal(setSendDiagnostics(false), false)
  assert.equal(uploads, false)
  assert.equal(analytics.at(-1), false)
  assert.deepEqual(broadcasts.at(-1), ['diagnostics:changed', false])
  assert.equal(syncValue(), false)
  assert.equal(syncValue('diagnostics:usage'), false)
  assert.deepEqual(JSON.parse(readFileSync(settingFile, 'utf8')), { send: false })
  setSendDiagnostics(true)
  assert.equal(uploads, false, 'upload consent is restored only at the next launch')
  assert.throws(() => setSendDiagnostics('no'))
})

test('a saved opt-out keeps uploads and analytics off from launch', async () => {
  writeFileSync(settingFile, JSON.stringify({ send: false }))
  await launch()

  assert.equal(started?.uploadToServer, false)
  assert.equal(analytics.at(-1), false)
  assert.equal(syncValue(), false)
})

test('finds only the Crashpad handlers left running for this crash dumps folder', async () => {
  const { leftoverCrashHandlers } = await launch()
  const dumps = '/Users/me/Library/Application Support/Nuphos/Crashpad'
  const ps = [
    `  501 /Applications/Nuphos.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler --database=${dumps} --url=https://api.nuphos.ai/desktop/crash-reports --annotation=_version=0.132.0`,
    ` 1204 /Applications/Nuphos.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler --monitor-self --database=${dumps}`,
    `  733 /Applications/Other.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler --database=${dumps}-other --url=x`,
    `  801 /usr/bin/vim --database=${dumps} notes.txt`,
    '',
  ].join('\n')

  assert.deepEqual(leftoverCrashHandlers(ps, dumps), [501, 1204])
})
