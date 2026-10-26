// Crash visibility for the main process. JavaScript errors go to PostHog.
// Native crashes (a V8 out-of-memory abort, a SIGTRAP) kill the process before
// any JavaScript telemetry can run. Crashpad's out-of-process handler writes a
// minidump and uploads it to the backend, which stores it for symbolication
// against Electron's public symbols. Packaged builds only.
//
// One setting, "Send crash reports and usage data" (default on, saved on this
// computer), gates crash uploads and both PostHog clients, and applies live.
// Electron itself adds ver, _version, platform and
// process_type; we add arch, a hashed device id (rate limiting only) and the
// heap / uptime numbers that tell a slow leak from a sudden spike.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getHeapStatistics } from 'node:v8'

import { app, BrowserWindow, crashReporter, ipcMain } from 'electron'

import { captureMainException, setMainAnalyticsEnabled } from './analytics.ts'
import { apiUrl } from './api-endpoint.ts'
import { readDeviceIdentity } from './main/device-identity.ts'
import { isDev } from './main/env.ts'

const ANNOTATE_EVERY_MS = 60_000
const mb = (bytes: number) => String(Math.round(bytes / 1024 / 1024))
const settingFile = () => path.join(app.getPath('userData'), 'diagnostics.json')
let sendDiagnostics = true
let crashpadStarted = false

function readSendDiagnostics(): boolean {
  try {
    return (JSON.parse(readFileSync(settingFile(), 'utf8')) as { send?: unknown }).send !== false
  } catch {
    return true
  }
}

function applySendDiagnostics(send: boolean): void {
  sendDiagnostics = send
  setMainAnalyticsEnabled(send)
  if (crashpadStarted) crashReporter.setUploadToServer(send)
}

/** Saves the setting and applies it now: crash uploads, main and renderer PostHog. */
export function setSendDiagnostics(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid diagnostics setting')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingFile(), JSON.stringify({ send: value }), { mode: 0o600 })
  applySendDiagnostics(value)
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send('diagnostics:changed', value)

  return value
}

export function watchCrashes(): void {
  applySendDiagnostics(readSendDiagnostics())
  // Synchronous so the renderer knows before its analytics starts.
  ipcMain.on('diagnostics:enabled', (event) => {
    event.returnValue = sendDiagnostics
  })
  // uncaughtExceptionMonitor (not uncaughtException) observes the crash WITHOUT
  // suppressing Node's default print-stack-and-exit behavior.
  process.on('uncaughtExceptionMonitor', (err) => {
    captureMainException(err, { kind: 'uncaught_exception' })
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
    captureMainException(reason, { kind: 'unhandled_rejection' })
  })
  if (isDev) return
  crashReporter.start({
    submitURL: `${apiUrl()}/desktop/crash-reports`,
    uploadToServer: sendDiagnostics,
    // The backend reads a plain multipart body.
    compress: false,
    // At most one upload per hour (macOS / Windows).
    rateLimit: true,
    globalExtra: {
      arch: process.arch,
      device: createHash('sha256').update(readDeviceIdentity().deviceId).digest('hex').slice(0, 32),
    },
  })
  crashpadStarted = true
  const startedAt = Date.now()
  const annotate = () => {
    const heap = getHeapStatistics()

    crashReporter.addExtraParameter('heap_used_mb', mb(heap.used_heap_size))
    crashReporter.addExtraParameter('heap_limit_mb', mb(heap.heap_size_limit))
    crashReporter.addExtraParameter('uptime_s', String(Math.round((Date.now() - startedAt) / 1000)))
  }

  annotate()
  setInterval(annotate, ANNOTATE_EVERY_MS).unref()
}
