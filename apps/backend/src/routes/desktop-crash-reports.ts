import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import {
  CRASH_REPORT_MAX_BYTES,
  consumeCrashReportRateLimit,
  crashReportMetadata,
  saveCrashReport,
} from '@/lib/crash-reports'
import { clientIp } from '@/lib/request-origin'

import type { CrashReportMetadata } from '@/lib/crash-reports'
import type { DownloadHandoffRateLimitResult } from '@/lib/download-handoff-rate-limit'

type Dependencies = {
  consume(input: { device: string; ip: string }): Promise<DownloadHandoffRateLimitResult>
  save(dump: Uint8Array, metadata: CrashReportMetadata): Promise<{ id: string }>
}

const DEVICE = /^[a-f0-9]{32}$/

// Public and unauthenticated: Crashpad's uploader runs outside the app and
// can't send the user's token. Bounded by a size cap and per-device + per-IP
// quotas; Redis failure is fail-closed like the other public write routes.
export function createCrashReportRoutes(dependencies: Dependencies) {
  const routes = new Hono()

  routes.post(
    '/',
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
      const dump = fields.upload_file_minidump

      if (!(dump instanceof File) || dump.size === 0) {
        return c.json({ error: 'invalid_request' }, 400)
      }
      const device =
        typeof fields.device === 'string' && DEVICE.test(fields.device) ? fields.device : 'unknown'
      const ip =
        clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')) ?? 'unknown'
      const result = await dependencies.consume({ device, ip })

      if (result === 'limited') return c.json({ error: 'rate_limited' }, 429)
      if (result === 'unavailable') return c.json({ error: 'limiter_unavailable' }, 503)

      const { id } = await dependencies.save(
        new Uint8Array(await dump.arrayBuffer()),
        crashReportMetadata(fields),
      )

      // Crashpad records the response body as the server-side report id.
      return c.text(id)
    },
  )

  return routes
}

export const crashReportRoutes = createCrashReportRoutes({
  consume: consumeCrashReportRateLimit,
  save: saveCrashReport,
})
