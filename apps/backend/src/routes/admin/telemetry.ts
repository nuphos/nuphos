import { AppError } from '@/lib/errors'
import { setTelemetryEnabled, telemetryStatus } from '@/lib/telemetry/report'

import type { AdminVars } from '@/routes/admin/auth'
import type { Hono } from 'hono'

export function registerAdminTelemetryRoutes(adminRoutes: Hono<{ Variables: AdminVars }>) {
  adminRoutes.get('/telemetry', async (c) => c.json(await telemetryStatus()))
  adminRoutes.put('/telemetry', async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    const enabled = (body as { enabled?: unknown } | null)?.enabled

    if (typeof enabled !== 'boolean') {
      throw new AppError(400, 'invalid_request', '`enabled` must be a boolean')
    }

    return c.json(await setTelemetryEnabled(enabled))
  })
}
