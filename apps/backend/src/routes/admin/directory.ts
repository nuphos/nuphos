import { fetchCachedTeams, fetchCachedUsers } from '@/lib/agent/directory'
import { AppError } from '@/lib/errors'
import {
  deleteTeamForAdmin,
  getTeamForAdmin,
  getUserForAdmin,
  listTeamsForAdmin,
  listUsersForAdmin,
  searchTeamsDirectory,
  searchUsersDirectory,
} from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import { cleanQuery, parseLimit, splitIdList } from '@/routes/admin/helpers'

import type { AdminVars } from '@/routes/admin/auth'
import type { Hono } from 'hono'

export function registerAdminDirectoryRoutes(adminRoutes: Hono<{ Variables: AdminVars }>) {
  adminRoutes.get('/directory/users', async (c) => {
    return c.json(
      await listUsersForAdmin({
        limit: parseLimit(c.req.query('limit')),
        cursor: cleanQuery(c.req.query('cursor')),
        q: cleanQuery(c.req.query('q')),
      }),
    )
  })

  adminRoutes.get('/directory/teams', async (c) => {
    return c.json(
      await listTeamsForAdmin({
        limit: parseLimit(c.req.query('limit')),
        cursor: cleanQuery(c.req.query('cursor')),
        q: cleanQuery(c.req.query('q')),
      }),
    )
  })

  adminRoutes.get('/directory/users/:id', async (c) => {
    const result = await getUserForAdmin(c.req.param('id'))

    if (!result) throw new AppError(404, 'not_found', 'User not found')

    return c.json(result)
  })

  adminRoutes.get('/directory/teams/:id', async (c) => {
    const result = await getTeamForAdmin(c.req.param('id'))

    if (!result) throw new AppError(404, 'not_found', 'Team not found')

    return c.json(result)
  })

  adminRoutes.delete('/directory/teams/:id', async (c) => {
    const teamId = c.req.param('id')
    const result = await deleteTeamForAdmin(teamId)

    if (result === 'team_not_found') {
      throw new AppError(404, 'not_found', 'Team not found')
    }
    logEvent('warn', 'admin.team.delete', {
      team_id: teamId,
      admin_user_id: c.get('adminUserId'),
    })

    return c.body(null, 204)
  })

  adminRoutes.get('/agent/directory/search', async (c) => {
    const type = c.req.query('type') === 'team' ? 'team' : 'user'
    const q = cleanQuery(c.req.query('q'))

    if (!q || q.length < 2) return c.json({ type, results: [] })
    const results = type === 'team' ? await searchTeamsDirectory(q) : await searchUsersDirectory(q)

    return c.json({ type, results })
  })

  adminRoutes.get('/agent/directory', async (c) => {
    const userIds = splitIdList(c.req.query('userIds'))
    const teamIds = splitIdList(c.req.query('teamIds'))
    const [users, teams] = await Promise.all([fetchCachedUsers(userIds), fetchCachedTeams(teamIds)])

    return c.json({ users, teams })
  })
}
