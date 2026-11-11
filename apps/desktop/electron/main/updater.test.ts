import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, beforeEach, mock, test } from 'node:test'

import type * as UpdaterModule from './updater.ts'

const RUNNING = '0.113.0'
const userData = mkdtempSync(join(tmpdir(), 'updater-test-'))
/** Electron's autoUpdater, which is Squirrel.Mac on macOS. */
const squirrel = new EventEmitter()

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
  log: string[] = []

  async checkForUpdates() {
    this.log.push('check')
    this.emit('checking-for-update')
    const updateInfo = { version: this.published }
    const isUpdateAvailable = this.published !== RUNNING

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
  mock.module('electron', {
    namedExports: {
      app: { getVersion: () => RUNNING, getPath: () => userData },
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
})

/** A fresh app launch: a new updater module, its events wired, one poll run. */
async function launch() {
  fake = new FakeUpdater()
  squirrel.removeAllListeners()
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

beforeEach(() => {
  // Each test starts as if no restart came before it.
  rmSync(join(userData, 'update-restart.json'), { force: true })
})

test('the staged update is still the newest: restart with no download or Squirrel staging in flight', async () => {
  await launchWithReadyUpdate()
  await updater.installUpdate()

  assert.deepEqual(fake.log, ['check', 'quit'])
})

test('a newer release downloads, and Squirrel.Mac stages it, before the restart', async () => {
  await launchWithReadyUpdate()
  fake.published = '0.113.2'
  await updater.installUpdate()

  assert.deepEqual(fake.log, ['check', 'download 0.113.2', 'squirrel staged 0.113.2', 'quit'])
})

test('a restart that comes back on the old version says the update did not install', async () => {
  await launchWithReadyUpdate()
  await updater.installUpdate()
  // The installer failed: the next launch still runs the old version.
  await launch()

  assert.deepEqual(updater.getUpdaterState(), {
    kind: 'ready',
    version: '0.113.1',
    installFailed: true,
  })
  // Said once: the launch after that is back to the plain offer.
  await launch()
  assert.deepEqual(updater.getUpdaterState(), {
    kind: 'ready',
    version: '0.113.1',
    installFailed: false,
  })
  assert.equal(existsSync(join(userData, 'update-restart.json')), false)
})
