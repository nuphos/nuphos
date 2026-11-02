import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

import { captureMain, captureMainException } from '../analytics'

import { isDev } from './env'
import { configureStableUpdateChannel } from './updater-channel'
import {
  classifyUpdaterError,
  createUpdaterErrorDedupe,
  updaterTelemetryError,
} from './updater-error'
import { markAppQuitting } from './window-session'

export const { autoUpdater } = electronUpdater

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | {
      kind: 'downloading'
      version: string
      transferred: number
      total: number
      bytesPerSecond: number
    }
  | { kind: 'ready'; version: string }
  | { kind: 'error' }

let updaterState: UpdaterState = { kind: 'idle' }
let updaterCheckTimer: ReturnType<typeof setInterval> | null = null
let lastProgressAt = 0

function setUpdaterState(next: UpdaterState) {
  // A downloaded update stays ready until the restart installs it.
  if (updaterState.kind === 'ready') return
  updaterState = next
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', next)
  }
}

export function getUpdaterState(): UpdaterState {
  return updaterState
}

/** A check while downloading or ready would only re-stage the same update.
 * electron-updater joins overlapping checks and skips unpacked builds; a failed
 * check also emits 'error', which sets the state and reports telemetry. */
export function checkForUpdates() {
  if (updaterState.kind === 'downloading' || updaterState.kind === 'ready') return
  autoUpdater.checkForUpdates().catch(() => null)
}

export function installUpdate() {
  if (updaterState.kind !== 'ready') return
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
    stopUpdatePolling()
    if (updaterState.kind === 'ready') return
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
