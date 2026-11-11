import { once } from 'node:events'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, autoUpdater as nativeUpdater, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

import { captureMain, captureMainException } from '../analytics.ts'

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
/** The version the last restart was meant to install, when the app came back without it. */
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

/** A check while downloading would only restart the same download, and one while
 * an update is ready would only download it again: the restart checks for itself.
 * electron-updater skips unpacked builds; a failed check also emits 'error',
 * which reports telemetry. */
export function checkForUpdates() {
  if (updaterState.kind === 'downloading' || updaterState.kind === 'ready') return
  void newestRelease().then(async (version) => {
    if (version) await autoUpdater.downloadUpdate().catch(() => null)
  })
}

/** The newest release when it is newer than this app, or null. Only checks: with
 * autoDownload on, electron-updater would download even the update that is
 * already staged, and on macOS hand it to Squirrel.Mac to stage again. */
async function newestRelease(): Promise<string | null> {
  const check = await autoUpdater.checkForUpdates().catch(() => null)

  return check?.isUpdateAvailable ? check.updateInfo.version : null
}

/** Squirrel.Mac takes the download from electron-updater, so it holds it a moment later. */
function stagedByOs() {
  return process.platform === 'darwin'
    ? once(nativeUpdater, 'update-downloaded')
    : Promise.resolve()
}

const restartFile = () => join(app.getPath('userData'), 'update-restart.json')

/** Restarts into the newest release. Releases ship several times a day, so one
 * may be out since the ready update downloaded; it downloads first, with its
 * progress showing, or the app would restart only to offer the next update.
 * Otherwise the restart starts with no update work in flight. */
export async function installUpdate() {
  if (updaterState.kind !== 'ready') return
  let version = updaterState.version
  const newest = await newestRelease()

  if (newest && newest !== version) {
    // A failed download shows as an error; the next check tries again.
    const staged = await Promise.all([autoUpdater.downloadUpdate(), stagedByOs()]).then(
      () => true,
      () => false,
    )

    if (!staged) return
    version = newest
  }
  // The installer runs after the app quits and can't report back. If the app
  // comes back on its old version, the next launch says so.
  try {
    writeFileSync(restartFile(), JSON.stringify({ version }))
  } catch {
    // Only the failure notice depends on it; the restart goes ahead.
  }
  // quitAndInstall closes every window before before-quit fires.
  markAppQuitting()
  autoUpdater.quitAndInstall()
}

/** The version the last restart was meant to install, if this app isn't it. */
function readFailedRestart(): string | null {
  try {
    const { version } = JSON.parse(readFileSync(restartFile(), 'utf8')) as { version: string }

    rmSync(restartFile())

    return version === app.getVersion() ? null : version
  } catch {
    return null
  }
}

export function startUpdatePolling() {
  if (isDev || updaterCheckTimer) return
  checkForUpdates()
  updaterCheckTimer = setInterval(checkForUpdates, 5 * 60 * 1000)
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
  autoUpdater.on('checking-for-update', () => setUpdaterState({ kind: 'checking' }))
  autoUpdater.on('update-not-available', () => setUpdaterState({ kind: 'up-to-date' }))
  autoUpdater.on('update-available', (info) =>
    setUpdaterState({
      kind: 'downloading',
      version: info.version,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
    }),
  )
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
  autoUpdater.on('update-downloaded', (info) => {
    captureMain('update_downloaded', { version: info.version })
    setUpdaterState({
      kind: 'ready',
      version: info.version,
      installFailed: info.version === failedVersion,
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
    // The raw message stays in telemetry; the UI shows one plain sentence.
    setUpdaterState({ kind: 'error' })
  })
}
