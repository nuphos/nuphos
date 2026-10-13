import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

import { captureMain, captureMainException } from '../analytics'
import { showAppDialog } from '../app-dialog'

import { isDev } from './env'
import { configureStableUpdateChannel } from './updater-channel'
import { checkOutcome, describeCheckOutcome } from './updater-check-result'
import {
  classifyUpdaterError,
  createUpdaterErrorDedupe,
  updaterTelemetryError,
} from './updater-error'
import { createUpdaterEventDedupe } from './updater-event-dedupe'

import type { InteractiveCheckOutcome } from './updater-check-result'

export const { autoUpdater } = electronUpdater

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'not-available' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

let updaterState: UpdaterState = { kind: 'idle' }
let updaterCheckInFlight = false
let updaterCheckTimer: ReturnType<typeof setInterval> | null = null

export function setUpdaterState(next: UpdaterState) {
  updaterState = next
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', next)
  }
}

export function checkForUpdatesOnce() {
  if (isDev || updaterCheckInFlight) return updaterState
  updaterCheckInFlight = true
  void autoUpdater
    .checkForUpdates()
    .catch((e: unknown) => {
      setUpdaterState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    })
    .finally(() => {
      updaterCheckInFlight = false
    })

  return updaterState
}

async function runInteractiveCheck(): Promise<InteractiveCheckOutcome> {
  if (isDev) return { kind: 'dev' }
  if (updaterCheckInFlight) return { kind: 'busy' }
  updaterCheckInFlight = true
  try {
    const result = await autoUpdater.checkForUpdates()

    return checkOutcome(app.getVersion(), result?.updateInfo.version)
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
  } finally {
    updaterCheckInFlight = false
  }
}

/** The app-menu "Check for Updates…" path: one check, one Nuphos dialog. */
export async function checkForUpdatesInteractive(): Promise<void> {
  const outcome = await runInteractiveCheck()
  const box = describeCheckOutcome(outcome)

  await showAppDialog(BrowserWindow.getFocusedWindow(), {
    title: 'Check for Updates',
    message: box.message,
    ...(box.detail ? { detail: box.detail } : {}),
  })
}

export function startUpdatePolling() {
  if (isDev || updaterCheckTimer) return
  checkForUpdatesOnce()
  updaterCheckTimer = setInterval(checkForUpdatesOnce, 5 * 60 * 1000)
}

export function stopUpdatePolling() {
  if (!updaterCheckTimer) return
  clearInterval(updaterCheckTimer)
  updaterCheckTimer = null
}

export function getUpdaterState(): UpdaterState {
  return updaterState
}

export function initAutoUpdaterEvents() {
  // The 5-minute poll re-fires update-available/update-downloaded for the same
  // pending version until the app restarts; capture each once per version.
  const shouldCapture = createUpdaterEventDedupe()
  const shouldCaptureError = createUpdaterErrorDedupe()

  configureStableUpdateChannel(autoUpdater)
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => setUpdaterState({ kind: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    if (shouldCapture('update_available', info.version)) {
      captureMain('update_available', { version: info.version })
    }
    setUpdaterState({ kind: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => setUpdaterState({ kind: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    setUpdaterState({ kind: 'downloading', percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) => {
    if (shouldCapture('update_downloaded', info.version)) {
      captureMain('update_downloaded', { version: info.version })
    }
    setUpdaterState({ kind: 'downloaded', version: info.version })
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
    setUpdaterState({ kind: 'error', message: err.message })
  })
}
