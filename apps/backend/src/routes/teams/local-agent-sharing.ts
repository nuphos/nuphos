import { z } from 'zod'

import { setTeamLocalAgentSharing } from '@/lib/agent/devices/local-share-ceiling'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const updateLocalAgentSharingSchema = z
  .object({
    level: z.enum(['off', 'approve', 'full']),
  })
  .strict()

/**
 * The team setting released desktops still send. Access to computers no longer
 * consults it (see box-access); it is stored only until it is removed.
 */
export function registerLocalAgentSharingRoutes(
  teamScoped: Hono<{ Variables: TeamAuthVariables }>,
) {
  teamScoped.put(
    '/local-agent-sharing',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', updateLocalAgentSharingSchema),
    async (c) => {
      const { level } = c.req.valid('json')
      const team = await setTeamLocalAgentSharing(c.get('teamId'), level)

      if (!team) throw new AppError(404, 'team_not_found', 'Team not found')

      return c.json({
        ...team,
        isOwner: team.ownerID === c.get('userId'),
        role: c.get('teamRole'),
      })
    },
  )
}
