// An agent signed in: every conversation that asked for it runs what waited.
import { agentConversations } from '@/lib/agent/db/shared'
import { logError, logEvent } from '@/lib/observability'

import { sessionReleased } from './session-released'

export type SettleDeps = {
  /** The conversations asking for a sign-in to this runtime. */
  asking: (teamId: string, runtimeId: string) => Promise<{ userId: string; sessionId: string }[]>
  /** Clears one conversation's ask; false when someone else already did. */
  clear: (sessionId: string, runtimeId: string) => Promise<boolean>
  released: (userId: string, sessionId: string) => void
}

export const settleDeps: SettleDeps = {
  asking: (teamId, runtimeId) =>
    agentConversations()
      .find(
        { teamId, 'signInRequest.runtimeId': runtimeId },
        { projection: { _id: 0, userId: 1, sessionId: 1 } },
      )
      .limit(500)
      .toArray(),
  clear: async (sessionId, runtimeId) =>
    (
      await agentConversations().updateOne(
        { sessionId, 'signInRequest.runtimeId': runtimeId },
        { $unset: { signInRequest: '' } },
      )
    ).modifiedCount > 0,
  released: sessionReleased,
}

/**
 * Releases each conversation's queue, so its held message runs as its sender's
 * own turn. Never throws: the sign-in itself already succeeded.
 */
export async function settleSignInRequests(
  teamId: string,
  runtimeId: string,
  deps: SettleDeps = settleDeps,
): Promise<number> {
  try {
    let settled = 0

    for (const { userId, sessionId } of await deps.asking(teamId, runtimeId)) {
      if (!(await deps.clear(sessionId, runtimeId))) continue
      deps.released(userId, sessionId)
      settled++
    }
    if (settled)
      logEvent('info', 'agent.sign_in_request.settled', {
        team_id: teamId,
        runtime_id: runtimeId,
        settled,
      })

    return settled
  } catch (error) {
    logError('agent.sign_in_request.settle_failed', error, { team_id: teamId })

    return 0
  }
}
