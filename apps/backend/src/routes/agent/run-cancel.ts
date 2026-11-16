import { getLocalActiveAgentRun } from '@/lib/agent/run-admission'
import { getActiveAgentRunForSession, requestAgentRunCancellation } from '@/lib/agent/run-store'
import { sessionReleased } from '@/lib/agent/session-released'
import { cancelConversationRuntime } from '@/lib/claude-code-preview/session-execution-state'
import { leaveMeeting } from '@/lib/meetings/recall'
import { logError } from '@/lib/observability'

import { agentRunKey, agentRuns } from './run-registry'

import type { AgentRun } from './types'
import type { AgentConversation } from '@/lib/agent/db'

/**
 * Deliver a cancellation request to a locally owned run without declaring it
 * finished. The producer/runtime remains responsible for appending terminal
 * frames and releasing the run's ownership after it has actually stopped.
 */
export function signalAgentRunCancellation(run: AgentRun): boolean {
  if (run.done) return false
  run.abortController.abort()

  return true
}

/**
 * Asks the turn holding a session to stop, on whichever replica runs it. A
 * runtime-started turn holds no claim, so nothing waits behind it.
 */
export async function cancelSessionRun(userId: string, sessionId: string): Promise<boolean> {
  const local = getLocalActiveAgentRun(userId, sessionId, { claimsOnly: true })
  const run = local && agentRuns.get(agentRunKey(userId, local.streamId))

  if (run) return signalAgentRunCancellation(run)
  const shared = await getActiveAgentRunForSession(userId, sessionId)

  return Boolean(
    shared && !shared.runtimeOwned && (await requestAgentRunCancellation(userId, shared.streamId)),
  )
}

/**
 * A conversation's Stop. It ends what a waiting message is behind: the
 * runtime's turn, and a run the backend still holds for the session, which a
 * dropped runtime connection can leave without the other. Then the queue goes.
 */
export async function stopConversationTurn(conversation: AgentConversation): Promise<void> {
  const { userId, sessionId } = conversation

  // The call's next sentence would start the turn again, so its bot leaves.
  // Not awaited: Stop never waits on Recall.
  if (conversation.meeting)
    void leaveMeeting(conversation.meeting.botId).catch((error: unknown) => {
      logError('meeting.leave_failed', error, { session_id: sessionId })
    })
  const runStopped = await cancelSessionRun(userId, sessionId)

  try {
    await cancelConversationRuntime(conversation)
  } catch (error) {
    if (!runStopped) throw error
  } finally {
    sessionReleased(userId, sessionId)
  }
}
