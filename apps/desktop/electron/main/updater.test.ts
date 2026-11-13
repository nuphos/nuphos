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
      BrowserWindow: { getAllWindows: () => [] },
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

test('the staged update is still the newest: restart with no download or Squirrel staging in flight', async () => {
  await launchWithReadyUpdate()
  await updater.installUpdate()

  assert.deepEqual(fake.log, ['check', 'quit'])
  assert.equal(recordedRestart(), '0.113.1')
})

test('a newer release downloads, and Squirrel.Mac stages it, before the restart', async () => {
  await launchWithReadyUpdate()
  fake.published = '0.113.2'
  await updater.installUpdate()

  assert.deepEqual(fake.log, ['check', 'download 0.113.2', 'squirrel staged 0.113.2', 'quit'])
  assert.equal(recordedRestart(), '0.113.2')
})

test('the check fails: restart into the staged update, with nothing in flight', async () => {
  await launchWithReadyUpdate()
  fake.checkFails = true
  await updater.installUpdate()

  assert.deepEqual(fake.log, ['check', 'quit'])
})

test('Squirrel.Mac fails to stage the newer release: no restart', async () => {
  await launchWithReadyUpdate()
  fake.published = '0.113.2'
  fake.stagingFails = true
  await updater.installUpdate()

  assert.deepEqual(fake.log, ['check', 'download 0.113.2', 'squirrel failed 0.113.2'])
  assert.equal(updater.getUpdaterState().kind, 'error')
  assert.equal(existsSync(restartFile), false)
})

test('a second click while the first is under way does nothing', async () => {
  await launchWithReadyUpdate()
  fake.published = '0.113.2'
  await Promise.all([updater.installUpdate(), updater.installUpdate()])

  assert.deepEqual(fake.log, ['check', 'download 0.113.2', 'squirrel staged 0.113.2', 'quit'])
})

test('a restart that comes back older says the update did not install, once', async () => {
  await launchWithReadyUpdate()
  await updater.installUpdate()
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
    await updater.installUpdate()
    // Installed as planned, or upgraded by hand past it.
    running = version
    await launch()

    assert.equal(updater.getUpdaterState().kind, 'up-to-date')
    assert.equal(existsSync(restartFile), false)
  }
})
