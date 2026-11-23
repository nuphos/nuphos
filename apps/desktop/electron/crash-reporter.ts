// Crash visibility for the main process. JavaScript errors go to PostHog.
// Native crashes (a V8 out-of-memory abort, a SIGTRAP) kill the process before
// any JavaScript telemetry can run. Crashpad's out-of-process handler writes a
// minidump and uploads it to the backend, which stores it for symbolication
// against Electron's public symbols. Packaged builds only.
//
// One setting, "Send crash reports and usage data" (default on, saved on this
// computer), gates crash reports and both PostHog clients. Usage data stops at
// once, including Crashpad uploads. Re-enabling uploads requires a restart.
// Usage data goes to Nuphos's own analytics, so it is only sent while the
// backend is Nuphos Cloud. Crash reports go to the backend itself.
// Electron itself adds ver, _version, platform and
// process_type; we add arch, a hashed device id (rate limiting only) and the
// heap / uptime numbers that tell a slow leak from a sudden spike.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getHeapStatistics } from 'node:v8'

import { app, BrowserWindow, crashReporter, ipcMain } from 'electron'

import { captureMainException, setMainAnalyticsEnabled } from './analytics.ts'
import { apiUrl, isNuphosCloud } from './api-endpoint.ts'
import { authSession } from './auth-session.ts'
import { readDeviceIdentity } from './main/device-identity.ts'
import { isDev } from './main/env.ts'

const ANNOTATE_EVERY_MS = 60_000
const mb = (bytes: number) => String(Math.round(bytes / 1024 / 1024))
const settingFile = () => path.join(app.getPath('userData'), 'diagnostics.json')
let sendDiagnostics = true
// The backend Crashpad uploads to. It is read once, at start.
let crashpadApi: string | undefined
const sendsUsage = () => sendDiagnostics && isNuphosCloud()

function readSendDiagnostics(): boolean {
  try {
    return (JSON.parse(readFileSync(settingFile(), 'utf8')) as { send?: unknown }).send !== false
  } catch {
    return true
  }
}

function applySendDiagnostics(send: boolean): void {
  sendDiagnostics = send
  setMainAnalyticsEnabled(sendsUsage())
  // Crashpad's destination is fixed at launch. Disable uploads for the rest of
  // this process after an endpoint change or opt-out; restart restores consent.
  if (crashpadApi && (!send || apiUrl() !== crashpadApi)) crashReporter.setUploadToServer(false)
}

/** Applies the setting now, and tells the renderers whether usage data is still sent. */
function changeSendDiagnostics(send: boolean): void {
  applySendDiagnostics(send)
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send('diagnostics:changed', sendsUsage())
}

/** Saves the setting and applies it now to crash reports and both PostHog clients. */
export function setSendDiagnostics(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid diagnostics setting')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingFile(), JSON.stringify({ send: value }), { mode: 0o600 })
  changeSendDiagnostics(value)

  return value
}

/**
 * The Crashpad handlers a quit Nuphos left running for these crash dumps. A process Nuphos
 * started that outlives it (a dev server, an agent's tool) inherits its Crashpad connection,
 * which keeps the handler alive, one more after every update (#4708).
 */
function leftoverCrashHandlers(ps: string, dumps: string): number[] {
  return ps
    .split('\n')
    .filter(
      (line) =>
        line.includes('chrome_crashpad_handler') && `${line} `.includes(`--database=${dumps} `),
    )
    .map((line) => Number.parseInt(line, 10))
    .filter((pid) => pid > 0)
}

/** Ends them before this launch starts its own; the instance lock means no running Nuphos uses them. */
function stopLeftoverCrashHandlers(): void {
  if (process.platform === 'win32') return
  try {
    const ps = execFileSync('/bin/ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf8' })

    for (const pid of leftoverCrashHandlers(ps, app.getPath('crashDumps'))) {
      try {
        process.kill(pid)
      } catch (error) {
        console.error('[crash-reporter] leftover handler', pid, error)
      }
    }
  } catch (error) {
    console.error('[crash-reporter] leftover handlers', error)
  }
}

export function watchCrashes(): void {
  applySendDiagnostics(readSendDiagnostics())
  // Synchronous so the renderer knows before its analytics starts.
  ipcMain.on('diagnostics:enabled', (event) => {
    event.returnValue = sendDiagnostics
  })
  ipcMain.on('diagnostics:usage', (event) => {
    event.returnValue = sendsUsage()
  })
  authSession.subscribe((next, prev) => {
    if (next.api !== prev.api) changeSendDiagnostics(sendDiagnostics)
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
  stopLeftoverCrashHandlers()
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
  crashpadApi = apiUrl()
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
