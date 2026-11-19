import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, beforeEach, mock, test } from 'node:test'

import type * as UpdaterModule from './updater.ts'

const userData = mkdtempSync(join(tmpdir(), 'updater-test-'))
const restartFile = join(userData, 'update-restart.json')
/** Electron's autoUpdater, which is Squirrel.Mac on macOS. */
const squirrel = new EventEmitter()
/** The version of the app that is running. */
let running = '0.113.0'

/** electron-updater as far as the app uses it. Like the real one, a check with
 * autoDownload on also downloads, and on macOS every finished download goes to
 * Squirrel.Mac, which stages it a moment later. */
class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  channel: string | null = null
  allowPrerelease = false
  allowDowngrade = false
  published = '0.113.1'
  checkFails = false
  stagingFails = false
  log: string[] = []

  async checkForUpdates() {
    this.log.push('check')
    this.emit('checking-for-update')
    await new Promise((resolve) => setImmediate(resolve))
    if (this.checkFails) {
      const error = new Error('net::ERR_INTERNET_DISCONNECTED')

      this.emit('error', error)
      throw error
    }
    const updateInfo = { version: this.published }
    const isUpdateAvailable = this.published.localeCompare(running, 'en', { numeric: true }) > 0

    this.emit(isUpdateAvailable ? 'update-available' : 'update-not-available', updateInfo)

    return {
      isUpdateAvailable,
      updateInfo,
      downloadPromise: isUpdateAvailable && this.autoDownload ? this.downloadUpdate() : null,
    }
  }

  async downloadUpdate() {
    const version = this.published

    this.log.push(`download ${version}`)
    await new Promise((resolve) => setImmediate(resolve))
    this.emit('update-downloaded', { version })
    setImmediate(() => {
      if (this.stagingFails) {
        this.log.push(`squirrel failed ${version}`)
        squirrel.emit('error', new Error('Squirrel.Mac could not stage the update'))

        return
      }
      this.log.push(`squirrel staged ${version}`)
      squirrel.emit('update-downloaded')
    })

    return []
  }

  quitAndInstall() {
    this.log.push('quit')
  }
}

let fake: FakeUpdater
let updater: typeof UpdaterModule
let loads = 0

before(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  Object.defineProperty(process, 'arch', { value: 'arm64' })
  mock.module('electron', {
    namedExports: {
      app: { getVersion: () => running, getPath: () => userData },
      autoUpdater: squirrel,
      // Every state the app shows goes into the log, in order with the update work.
      BrowserWindow: {
        getAllWindows: () => [
          {
            webContents: {
              send: (_channel: string, state: { kind: string }) =>
                fake.log.push(`show ${state.kind}`),
            },
          },
        ],
      },
    },
  })
  mock.module('electron-updater', {
    defaultExport: {
      get autoUpdater() {
        return fake
      },
    },
  })
  mock.module('../analytics.ts', {
    namedExports: { captureMain: mock.fn(), captureMainException: mock.fn() },
  })
  mock.module('./window-session.ts', { namedExports: { markAppQuitting: mock.fn() } })
  // The idle restart polls powerMonitor once a minute; these tests restart by hand.
  mock.module('./auto-update-electron.ts', { namedExports: { startAutoInstall: mock.fn() } })
})

beforeEach(() => {
  running = '0.113.0'
  rmSync(restartFile, { force: true })
})

/** A fresh app launch: a new updater module, its events wired, one poll run. */
async function launch() {
  fake = new FakeUpdater()
  squirrel.removeAllListeners()
  // Squirrel errors also reach electron-updater, as MacUpdater forwards them.
  squirrel.on('error', (error: Error) => fake.emit('error', error))
  loads += 1
  updater = (await import(`./updater.ts?launch=${String(loads)}`)) as typeof updater
  updater.initAutoUpdaterEvents()
  updater.checkForUpdates()
  await settle()
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
}

async function launchWithReadyUpdate() {
  await launch()
  assert.partialDeepStrictEqual(updater.getUpdaterState(), { kind: 'ready', version: '0.113.1' })
  fake.log = []
}

const recordedRestart = () =>
  (JSON.parse(readFileSync(restartFile, 'utf8')) as { version: string }).version

test('an update is offered only once Squirrel.Mac has staged it', async () => {
  await launch()

  assert.deepEqual(fake.log, [
    'show checking',
    'check',
    'show downloading',
    'download 0.113.1',
    'squirrel staged 0.113.1',
    'show ready',
  ])
})

test('restart with no check, download or Squirrel staging in flight', async () => {
  await launchWithReadyUpdate()
  updater.installUpdate()

  assert.deepEqual(fake.log, ['quit'])
  assert.equal(recordedRestart(), '0.113.1')
})

test('a check while an update is ready, with nothing newer, leaves it on offer', async () => {
  await launchWithReadyUpdate()
  updater.checkForUpdates()
  await settle()

  assert.deepEqual(fake.log, ['check'])
  assert.equal(updater.getUpdaterState().kind, 'ready')
})

test('a failed check while an update is ready leaves it on offer', async () => {
  await launchWithReadyUpdate()
  fake.checkFails = true
  updater.checkForUpdates()
  await settle()

  assert.equal(updater.getUpdaterState().kind, 'ready')
})

test('a newer release downloads in the background, and the restart installs it', async () => {
  await launchWithReadyUpdate()
  fake.published = '0.113.2'
  updater.checkForUpdates()
  await settle()
  updater.installUpdate()

  assert.deepEqual(fake.log, [
    'check',
    'show downloading',
    'download 0.113.2',
    'squirrel staged 0.113.2',
    'show ready',
    'quit',
  ])
  assert.equal(recordedRestart(), '0.113.2')
})

test('no restart while the newer release is still downloading or staging', async () => {
  await launchWithReadyUpdate()
  fake.published = '0.113.2'
  updater.checkForUpdates()
  // electron-updater has the download, Squirrel.Mac does not have it yet.
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  updater.installUpdate()

  assert.equal(fake.log.includes('quit'), false)
  assert.equal(updater.getUpdaterState().kind, 'downloading')
})

test('Squirrel.Mac fails to stage: an error, and nothing to restart into', async () => {
  await launchWithReadyUpdate()
  fake.stagingFails = true
  fake.published = '0.113.2'
  updater.checkForUpdates()
  await settle()
  updater.installUpdate()

  assert.equal(updater.getUpdaterState().kind, 'error')
  assert.equal(fake.log.includes('quit'), false)
  assert.equal(existsSync(restartFile), false)
})

test('a poll and a click at once run one check', async () => {
  await launchWithReadyUpdate()
  fake.published = '0.113.2'
  updater.checkForUpdates()
  updater.checkForUpdates()
  await settle()

  assert.deepEqual(
    fake.log.filter((step) => !step.startsWith('show')),
    ['check', 'download 0.113.2', 'squirrel staged 0.113.2'],
  )
})

test('a restart that comes back older says the update did not install, once', async () => {
  await launchWithReadyUpdate()
  updater.installUpdate()
  // The installer failed: the next launch still runs 0.113.0.
  await launch()

  assert.deepEqual(updater.getUpdaterState(), {
    kind: 'ready',
    version: '0.113.1',
    installerUrl: 'https://nuphos.ai/api/desktop/download?platform=mac&arch=arm64',
  })
  assert.equal(existsSync(restartFile), false)
  await launch()
  assert.deepEqual(updater.getUpdaterState(), {
    kind: 'ready',
    version: '0.113.1',
    installerUrl: null,
  })
})

test('a launch on the target or a newer version is not a failed restart', async () => {
  for (const version of ['0.113.1', '0.113.2', '0.114.0']) {
    running = '0.113.0'
    await launchWithReadyUpdate()
    updater.installUpdate()
    // Installed as planned, or upgraded by hand past it.
    running = version
    await launch()

    assert.equal(updater.getUpdaterState().kind, 'up-to-date')
    assert.equal(existsSync(restartFile), false)
  }
})
