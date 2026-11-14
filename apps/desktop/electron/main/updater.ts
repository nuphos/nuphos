import { once } from 'node:events'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, autoUpdater as nativeUpdater, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

import { captureMain, captureMainException } from '../analytics.ts'

import { startAutoInstall } from './auto-update-electron.ts'
import { isDev } from './env.ts'
import { configureStableUpdateChannel } from './updater-channel.ts'
import {
  classifyUpdaterError,
  createUpdaterErrorDedupe,
  updaterTelemetryError,
} from './updater-error.ts'
import { markAppQuitting } from './window-session.ts'

import type { UpdaterState } from './updater-state.ts'

export const { autoUpdater } = electronUpdater

export type { UpdaterState } from './updater-state.ts'

let updaterState: UpdaterState = { kind: 'idle' }
let updaterCheckTimer: ReturnType<typeof setInterval> | null = null
let lastProgressAt = 0
/** The version the last restart was meant to install, when the app came back older. */
let failedVersion: string | null = null

function setUpdaterState(next: UpdaterState) {
  updaterState = next
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', next)
  }
}

export function getUpdaterState(): UpdaterState {
  return updaterState
}

/** The check under way, so a poll and a click don't start a second one. */
let update: Promise<void> | null = null

/** Checks for a release newer than this app and downloads it, unless it is the
 * update already ready. It runs while an update is ready too, so a restart
 * installs the newest release without downloading anything then. electron-updater
 * skips unpacked builds; a failure also emits 'error', which reports telemetry. */
export function checkForUpdates() {
  update ??= downloadNewest().finally(() => {
    update = null
  })
}

/** The state follows this flow, not electron-updater's events: those fire for
 * every check, and on macOS 'update-downloaded' fires before Squirrel.Mac has the
 * update, so a restart then would wait on Squirrel with nothing on screen. */
async function downloadNewest() {
  const ready = updaterState.kind === 'ready' ? updaterState.version : null

  // An update that is ready stays on offer while the check runs.
  if (!ready) setUpdaterState({ kind: 'checking' })
  try {
    const check = await autoUpdater.checkForUpdates()
    const version = check?.isUpdateAvailable ? check.updateInfo.version : null

    if (!version) {
      if (!ready) setUpdaterState({ kind: 'up-to-date' })

      return
    }
    if (version === ready) return
    setUpdaterState({ kind: 'downloading', version, transferred: 0, total: 0, bytesPerSecond: 0 })
    await Promise.all([autoUpdater.downloadUpdate(), stagedByOs()])
    captureMain('update_downloaded', { version })
    setUpdaterState({
      kind: 'ready',
      version,
      installerUrl: version === failedVersion ? installerUrl() : null,
    })
  } catch {
    // A failed check leaves a ready update on offer; a failed download leaves none.
    if (updaterState.kind !== 'ready') setUpdaterState({ kind: 'error' })
  }
}

/** Squirrel.Mac takes the download from electron-updater, so it holds it a moment later. */
function stagedByOs() {
  return process.platform === 'darwin'
    ? once(nativeUpdater, 'update-downloaded')
    : Promise.resolve()
}

const restartFile = () => join(app.getPath('userData'), 'update-restart.json')

/** Restarts into the ready update. It is ready only once it is staged, so the
 * restart starts with no update work in flight. */
export function installUpdate() {
  if (updaterState.kind !== 'ready') return
  // The installer runs after the app quits and can't report back. If the app
  // comes back on its old version, the next launch says so.
  try {
    writeFileSync(restartFile(), JSON.stringify({ version: updaterState.version }))
  } catch {
    // Only the failure notice depends on it; the restart goes ahead.
  }
  // quitAndInstall closes every window before before-quit fires.
  markAppQuitting()
  autoUpdater.quitAndInstall()
}

/** The version the last restart was meant to install, if this app is older than
 * it. Read once: the record is gone after the first launch that reads it. */
function readFailedRestart(): string | null {
  try {
    const { version } = JSON.parse(readFileSync(restartFile(), 'utf8')) as { version: string }

    rmSync(restartFile())

    return isOlder(app.getVersion(), version) ? version : null
  } catch {
    return null
  }
}

/** Whether release `a` is older than `b`; Nuphos ships plain major.minor.patch. */
function isOlder(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))

  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i]
  }

  return false
}

/** The installer for this platform and architecture, from the Nuphos download page. */
function installerUrl(): string {
  const platform = { darwin: 'mac', win32: 'windows' }[process.platform as string] ?? 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

  return `https://nuphos.ai/api/desktop/download?platform=${platform}&arch=${arch}`
}

export function startUpdatePolling() {
  if (isDev || updaterCheckTimer) return
  checkForUpdates()
  updaterCheckTimer = setInterval(checkForUpdates, 5 * 60 * 1000)
  startAutoInstall({
    ready: () =>
      updaterState.kind === 'ready' ? { failedBefore: updaterState.installerUrl !== null } : null,
    install: installUpdate,
  })
}

export function stopUpdatePolling() {
  if (!updaterCheckTimer) return
  clearInterval(updaterCheckTimer)
  updaterCheckTimer = null
}

export function initAutoUpdaterEvents() {
  const shouldCaptureError = createUpdaterErrorDedupe()

  failedVersion = readFailedRestart()
  if (failedVersion) {
    captureMain('update_install_failed', {
      version: failedVersion,
      current_version: app.getVersion(),
    })
  }
  configureStableUpdateChannel(autoUpdater)
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('download-progress', (p) => {
    // Progress fires many times a second; about once a second is enough to read.
    const now = Date.now()

    if (updaterState.kind !== 'downloading' || now - lastProgressAt < 1000) return
    lastProgressAt = now
    setUpdaterState({
      ...updaterState,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    })
  })
  autoUpdater.on('error', (err) => {
    const category = classifyUpdaterError(err.message)

    if (shouldCaptureError(category)) {
      captureMainException(updaterTelemetryError(err), {
        kind: 'auto_updater_error',
        updater_error_category: category,
        current_version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        $exception_fingerprint: `desktop_updater:${category}`,
      })
    }
  })
}
