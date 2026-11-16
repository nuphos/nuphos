import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { setTeamBindingShareDefault } from '@/lib/identity'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamJson } from '@/routes/teams/management'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

/** Whether bindings members connect from now on start shared with the whole team. */
export function registerBindingShareRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.put(
    '/binding-share-default',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', z.object({ share: z.enum(['private', 'team']) })),
    async (c) => {
      const team = await setTeamBindingShareDefault(c.get('teamId'), c.req.valid('json').share)

      if (!team) throw new AppError(404, 'team_not_found', 'Team not found')

      return teamJson(c, team)
    },
  )
}
