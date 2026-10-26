// Crash visibility for the main process. JavaScript errors go to PostHog.
// Native crashes (a V8 out-of-memory abort, a SIGTRAP) kill the process before
// any JavaScript telemetry can run. Crashpad's out-of-process handler writes a
// minidump and uploads it to the backend, which stores it for symbolication
// against Electron's public symbols. Same gate as main-process analytics:
// packaged builds only. Electron itself adds ver, _version, platform and
// process_type; we add arch, a hashed device id (rate limiting only) and the
// heap / uptime numbers that tell a slow leak from a sudden spike.
import { createHash } from 'node:crypto'
import { getHeapStatistics } from 'node:v8'

import { crashReporter } from 'electron'

import { captureMainException } from './analytics.ts'
import { apiUrl } from './api-endpoint.ts'
import { readDeviceIdentity } from './main/device-identity.ts'
import { isDev } from './main/env.ts'

const ANNOTATE_EVERY_MS = 60_000
const mb = (bytes: number) => String(Math.round(bytes / 1024 / 1024))

export function watchCrashes(): void {
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
    uploadToServer: true,
    // The backend reads a plain multipart body.
    compress: false,
    // At most one upload per hour (macOS / Windows).
    rateLimit: true,
    globalExtra: {
      arch: process.arch,
      device: createHash('sha256').update(readDeviceIdentity().deviceId).digest('hex').slice(0, 32),
    },
  })
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
