// Monitoring overview — read-only aggregation across the team's bound
// observability providers. Mounted at `/teams/:teamId/monitoring` from
// `teams.ts`. There are deliberately no mutation endpoints here: monitors are
// created/edited through the agent (provider-native skills) or the provider's
// own console.

import { Hono } from 'hono'

import { aggregateMonitoringOverview } from '@/lib/monitoring/overview'
import { parseObjectId } from '@/lib/objectid'
import { canRequestUseBinding, requireTeamMember } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'

export const monitoringRoutes = new Hono<{ Variables: TeamAuthVariables }>()
monitoringRoutes.use('*', requireTeamMember())

monitoringRoutes.get('/overview', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const overview = await aggregateMonitoringOverview(teamId, (access) =>
    canRequestUseBinding(c, access),
  )

  return c.json(overview)
})
