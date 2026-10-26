import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import {
  CRASH_REPORT_MAX_BYTES,
  consumeCrashReportDeviceQuota,
  consumeCrashReportIpQuota,
  crashReportMetadata,
  isMinidump,
  saveCrashReport,
} from '@/lib/crash-reports'
import { clientIp } from '@/lib/request-origin'

import type { CrashReportMetadata } from '@/lib/crash-reports'
import type { DownloadHandoffRateLimitResult } from '@/lib/download-handoff-rate-limit'
import type { Context } from 'hono'

type Quota = Promise<DownloadHandoffRateLimitResult>
type Dependencies = {
  consumeIp(ip: string): Quota
  consumeDevice(device: string): Quota
  save(dump: Uint8Array, metadata: CrashReportMetadata): Promise<{ id: string }>
}

const DEVICE = /^[a-f0-9]{32}$/

function quotaError(c: Context, result: DownloadHandoffRateLimitResult) {
  if (result === 'limited') return c.json({ error: 'rate_limited' }, 429)
  if (result === 'unavailable') return c.json({ error: 'limiter_unavailable' }, 503)

  return null
}

// Public and unauthenticated: Crashpad's uploader runs outside the app and
// can't send the user's token. The per-IP and global quotas are spent before
// the body is read; then a 10 MB cap, the minidump signature and a per-device
// quota. Redis failure is fail-closed like the other public write routes.
export function createCrashReportRoutes(dependencies: Dependencies) {
  const routes = new Hono()

  routes.post(
    '/',
    async (c, next) => {
      const ip =
        clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')) ?? 'unknown'

      return quotaError(c, await dependencies.consumeIp(ip)) ?? next()
    },
    bodyLimit({
      maxSize: CRASH_REPORT_MAX_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
    async (c) => {
      let fields: Record<string, unknown>

      try {
        fields = await c.req.parseBody()
      } catch {
        return c.json({ error: 'invalid_request' }, 400)
      }
      const file = fields.upload_file_minidump
      const dump = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null

      if (!dump || !isMinidump(dump)) return c.json({ error: 'invalid_request' }, 400)
      const device =
        typeof fields.device === 'string' && DEVICE.test(fields.device) ? fields.device : 'unknown'
      const limited = quotaError(c, await dependencies.consumeDevice(device))

      if (limited) return limited
      const { id } = await dependencies.save(dump, crashReportMetadata(fields))

      // Crashpad records the response body as the server-side report id.
      return c.text(id)
    },
  )

  return routes
}

export const crashReportRoutes = createCrashReportRoutes({
  consumeIp: consumeCrashReportIpQuota,
  consumeDevice: consumeCrashReportDeviceQuota,
  save: saveCrashReport,
})
