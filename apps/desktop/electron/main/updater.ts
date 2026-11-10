import { once } from 'node:events'

import { app, autoUpdater as nativeUpdater, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

import { captureMain, captureMainException } from '../analytics'

import { isDev } from './env'
import { configureStableUpdateChannel } from './updater-channel'
import {
  classifyUpdaterError,
  createUpdaterErrorDedupe,
  updaterTelemetryError,
} from './updater-error'
import { awaitLatestStaged } from './updater-install'
import { markAppQuitting } from './window-session'

import type { UpdaterState } from './updater-state'

export const { autoUpdater } = electronUpdater

export type { UpdaterState } from './updater-state'

let updaterState: UpdaterState = { kind: 'idle' }
let updaterCheckTimer: ReturnType<typeof setInterval> | null = null
let lastProgressAt = 0

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
  autoUpdater.checkForUpdates().catch(() => null)
}

/** Squirrel.Mac takes the download from electron-updater, so it holds it a moment later. */
function stagedByOs() {
  return process.platform === 'darwin'
    ? once(nativeUpdater, 'update-downloaded')
    : Promise.resolve()
}

/** Restarts into the newest release. Releases ship several times a day, so one
 * may be out since the ready update downloaded; it downloads first, with its
 * progress showing, or the app would restart only to offer the next update. */
export async function installUpdate() {
  if (updaterState.kind !== 'ready') return
  const staged = updaterState.version
  const check = await autoUpdater.checkForUpdates().catch(() => null)

  // A failed download shows as an error; the next check tries again.
  if (!(await awaitLatestStaged(check, staged, stagedByOs))) return
  // quitAndInstall closes every window before before-quit fires.
  markAppQuitting()
  autoUpdater.quitAndInstall()
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

  configureStableUpdateChannel(autoUpdater)
  autoUpdater.autoDownload = true
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
    setUpdaterState({ kind: 'ready', version: info.version })
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
