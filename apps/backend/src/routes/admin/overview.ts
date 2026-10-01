import { getAdminOverview } from '@/lib/admin/overview'

import type { AdminVars } from '@/routes/admin/auth'
import type { Hono } from 'hono'

export function registerAdminOverviewRoutes(adminRoutes: Hono<{ Variables: AdminVars }>) {
  adminRoutes.get('/overview', async (c) => c.json(await getAdminOverview()))
}
