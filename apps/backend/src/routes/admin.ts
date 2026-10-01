import { Hono } from 'hono'

import type { AdminVars } from '@/routes/admin/auth'

import { listDeletionRequests, updateDeletionRequest } from '@/lib/identity/account-deletion'
import { registerAdminAgentRoutes } from '@/routes/admin/agent'
import { requireAdmin } from '@/routes/admin/auth'
import { registerAdminDirectoryRoutes } from '@/routes/admin/directory'
import { registerAdminFinopsRoutes } from '@/routes/admin/finops'
import { registerAdminOverviewRoutes } from '@/routes/admin/overview'
import { registerAdminSlackAddressingRoutes } from '@/routes/admin/slack-addressing'
import { adminSkillsRoutes } from '@/routes/admin-skills'

export const adminRoutes = new Hono<{ Variables: AdminVars }>()

adminRoutes.use('*', requireAdmin)

// Lightweight validation endpoint used by the Admin frontend before it
// renders protected pages. The auth middleware has already verified both the
// Nuphos session and membership in the configured admin team.
adminRoutes.get('/session', (c) => {
  return c.json({ userId: c.get('adminUserId') })
})

adminRoutes.get('/account-deletions', async (c) => c.json(await listDeletionRequests()))
adminRoutes.patch('/account-deletions/:id', async (c) =>
  c.json(
    await updateDeletionRequest(
      c.req.param('id'),
      c.get('adminUserId')!,
      await c.req.json().catch(() => null),
    ),
  ),
)

adminRoutes.route('/skills', adminSkillsRoutes)

registerAdminAgentRoutes(adminRoutes)
registerAdminDirectoryRoutes(adminRoutes)
registerAdminFinopsRoutes(adminRoutes)
registerAdminOverviewRoutes(adminRoutes)
registerAdminSlackAddressingRoutes(adminRoutes)
