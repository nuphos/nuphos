import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import {
  createTeamForUser,
  getDiscoverableTeamsForEmail,
  getMyTeams,
  joinTeamByEmailDomain,
} from '@/lib/identity'
import { zv } from '@/lib/validate'

import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export function registerTeamsRootRoutes(teamsRoutes: Hono<{ Variables: AuthVariables }>) {
  teamsRoutes.get('/', async (c) => {
    const userId = c.get('userId')
    const teams = await getMyTeams(userId)

    return c.json({
      teams: teams.map((t) => ({ ...t, isOwner: t.ownerID === userId })),
    })
  })

  teamsRoutes.post('/', zv('json', createTeamSchema), async (c) => {
    const userId = c.get('userId')
    const { name } = c.req.valid('json')
    const team = await createTeamForUser(userId, name)

    // `createTeamForUser` reports the creator's seeded role, so this response
    // carries the same fields GET / does. Clients adopt it as the active team
    // without refetching — a role-less team here reads as "not an admin" and
    // locks the creator out of every admin-only surface.
    return c.json({ team: { ...team, isOwner: true } }, 201)
  })

  // Workspace discovery by email domain: teams that list the signed-in user's
  // email domain in allowedEmailDomains and that the user hasn't joined yet.
  // Registered before the `/:teamId` mount so the static segment wins.
  teamsRoutes.get('/discoverable', async (c) => {
    const teams = await getDiscoverableTeamsForEmail(c.get('userId'), c.get('userEmail'))

    return c.json({ teams })
  })

  teamsRoutes.post('/discoverable/:teamId/join', async (c) => {
    const teamId = c.req.param('teamId')

    if (!ObjectId.isValid(teamId)) {
      throw new AppError(400, 'invalid_id', `Invalid teamId: ${teamId}`)
    }
    const result = await joinTeamByEmailDomain(teamId, c.get('userId'), c.get('userEmail'))

    if (result.kind === 'team_not_found') {
      throw new AppError(404, 'team_not_found', 'Team not found')
    }
    if (result.kind === 'not_allowed') {
      throw new AppError(
        403,
        'domain_not_allowed',
        'Your email domain is not allowed to join this team',
      )
    }
    if (result.kind === 'already_member') {
      throw new AppError(409, 'already_member', 'You are already a member of this team')
    }

    return c.json(
      {
        team: {
          ...result.team,
          isOwner: false,
          role: 'EDITOR' as const,
        },
      },
      201,
    )
  })
}
