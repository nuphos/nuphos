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

import type { InteractiveCheckOutcome } from './updater-check-result'

export const { autoUpdater } = electronUpdater

// The only update fact the UI needs: the version downloaded and waiting for a
// restart. Restarting installs it, so it is never cleared.
let readyVersion: string | null = null
let updaterCheckTimer: ReturnType<typeof setInterval> | null = null

export function getReadyVersion(): string | null {
  return readyVersion
}

export function installReadyUpdate() {
  if (readyVersion) autoUpdater.quitAndInstall()
}

// electron-updater joins overlapping checks into one and skips unpacked builds.
// A failed check also emits 'error', which is where telemetry captures it.
function pollOnce() {
  autoUpdater.checkForUpdates().catch(() => null)
}

async function runInteractiveCheck(): Promise<InteractiveCheckOutcome> {
  if (readyVersion) return { kind: 'ready', version: readyVersion }
  try {
    const result = await autoUpdater.checkForUpdates()

    return checkOutcome(app.getVersion(), result?.updateInfo.version)
  } catch {
    return { kind: 'error' }
  }
}

/** The app-menu "Check for Updates…" path: one check, one Nuphos dialog. */
export async function checkForUpdatesInteractive(): Promise<void> {
  const box = describeCheckOutcome(await runInteractiveCheck())
  const restart = await showAppDialog(BrowserWindow.getFocusedWindow(), {
    title: 'Check for Updates',
    ...box,
  })

  if (restart) installReadyUpdate()
}

export function startUpdatePolling() {
  if (isDev || updaterCheckTimer || readyVersion) return
  pollOnce()
  updaterCheckTimer = setInterval(pollOnce, 5 * 60 * 1000)
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
  autoUpdater.on('update-downloaded', (info) => {
    // Another poll would only re-stage the same download.
    stopUpdatePolling()
    if (readyVersion === info.version) return
    readyVersion = info.version
    captureMain('update_downloaded', { version: info.version })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('updater:ready', info.version)
    }
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
