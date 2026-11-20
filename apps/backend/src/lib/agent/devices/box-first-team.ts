// A user's first team starts with its free Box already on the way, so a new account has a
// computer by the time it reaches the app (#4186). It is the Box the user could create by hand:
// the same create path, the smallest size, and the free allowance's one-Box-per-team and hours.

import { ObjectId } from 'mongodb'

import { teams } from '@/lib/identity/shared'
import { logError, logEvent } from '@/lib/observability'

import { freeAllowance } from './box-free'
import { boxesAvailable } from './box-instabox-client'
import { createBox } from './box-instabox-create'

export type FirstTeamBoxDeps = {
  /** How many teams the user owns, this one included. */
  ownedTeams: (userId: string) => Promise<number>
  create: (userId: string, teamId: string, label: string) => Promise<unknown>
}

const defaultDeps: FirstTeamBoxDeps = {
  ownedTeams: (userId) =>
    teams().countDocuments({ ownerID: new ObjectId(userId), deletedAt: { $exists: false } }),
  create: (userId, teamId, label) => createBox(userId, teamId, label),
}

/**
 * Starts the free Box of `teamId` when it is the first team `userId` made and the deployment
 * gives teams a free Box. Never throws: a Box that cannot start leaves the team as it was.
 */
export async function startFirstTeamBox(
  userId: string,
  teamId: string,
  deps: FirstTeamBoxDeps = defaultDeps,
): Promise<void> {
  if (!freeAllowance() || !boxesAvailable()) return
  try {
    if ((await deps.ownedTeams(userId)) !== 1) return
    await deps.create(userId, teamId, 'Computer 1')
    logEvent('info', 'agent.box.first_team_started', { user_id: userId, team_id: teamId })
  } catch (error) {
    logError('agent.box.first_team_failed', error, { user_id: userId, team_id: teamId })
  }
}
