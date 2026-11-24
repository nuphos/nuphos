// A user's first team starts with its free Box already on the way, so a new account has a
// computer by the time it reaches the app (#4186). It is the Box the user could create by hand:
// the same create path, the smallest size, and the free allowance's one-Box-per-team and hours.
// Its OpenCode comes signed in to OpenRouter on a small key Nuphos gives, where the deployment does.

import { createBox } from '@/lib/agent/devices/box-instabox-create'
import { getMyTeams } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'

import { freeAllowance } from './box-free'
import { boxesAvailable } from './box-instabox-client'

/**
 * Starts the free Box of `teamId` when it is the only team `userId` owns and the deployment
 * gives teams a free Box. Never throws: a Box that cannot start leaves the team as it was.
 */
export async function startFirstTeamBox(userId: string, teamId: string): Promise<void> {
  if (!freeAllowance() || !boxesAvailable()) return
  try {
    const owned = (await getMyTeams(userId)).filter((team) => team.ownerID === userId)

    if (owned.length !== 1) return
    await createBox(userId, teamId, 'Computer 1', { openRouterGift: true })
    logEvent('info', 'agent.box.first_team_started', { user_id: userId, team_id: teamId })
  } catch (error) {
    logError('agent.box.first_team_failed', error, { user_id: userId, team_id: teamId })
  }
}
