import { z } from 'zod'

import { revokeAllTeamDeviceShares } from '@/lib/agent/devices/local-share-revoke'
import { setTeamLocalAgentSharing } from '@/lib/agent/devices/local-share-ceiling'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'
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
 * The most a member may grant when sharing their own computer's Local Agent; see
 * lib/agent/devices/local-share. Lowering it applies on the next turn; turning it
 * off also closes teammates' open streams at once.
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
      if (level === 'off')
        await revokeAllTeamDeviceShares(
          c.get('teamId'),
          (await getTeamMembers(c.get('teamId'))).map((member) => member.id),
        )

      return c.json({
        ...team,
        isOwner: team.ownerID === c.get('userId'),
        role: c.get('teamRole'),
      })
    },
  )
}
