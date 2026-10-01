import { resolveFinopsRange, recentMonthKeys } from '@/lib/agent/finops-range'
import {
  getFinopsSummary,
  getFinopsTeamUsers,
  getFinopsUserSessions,
} from '@/lib/agent/finops-usage'
import { AppError } from '@/lib/errors'

import type { FinopsRange } from '@/lib/agent/finops-range'
import type { AdminVars } from '@/routes/admin/auth'
import type { Context, Hono } from 'hono'

// The team drill-down uses '-' for the no-team bucket: an empty path segment
// would collapse the route, and no real team id is a single dash.
const NO_TEAM_SEGMENT = '-'

function teamIdFromParam(value: string): string {
  return value === NO_TEAM_SEGMENT ? '' : value
}

// An unrecognised range is a 400, never a silent fallback: answering a
// different window than the caller asked for would look like real data.
function rangeFromQuery(c: Context): FinopsRange {
  const range = resolveFinopsRange(c.req.query('range'))

  if (!range) throw new AppError(400, 'bad_request', 'Unknown range')

  return range
}

export function registerAdminFinopsRoutes(adminRoutes: Hono<{ Variables: AdminVars }>) {
  adminRoutes.get('/finops/summary', async (c) => {
    const summary = await getFinopsSummary(rangeFromQuery(c))

    return c.json({ ...summary, months: recentMonthKeys() })
  })

  adminRoutes.get('/finops/teams/:teamId/users', async (c) => {
    return c.json(
      await getFinopsTeamUsers(teamIdFromParam(c.req.param('teamId')), rangeFromQuery(c)),
    )
  })

  adminRoutes.get('/finops/teams/:teamId/users/:userId/sessions', async (c) => {
    const userId = c.req.param('userId')

    if (!userId) throw new AppError(400, 'bad_request', 'userId is required')

    return c.json(
      await getFinopsUserSessions(
        teamIdFromParam(c.req.param('teamId')),
        userId,
        rangeFromQuery(c),
      ),
    )
  })
}
