import { getLocalActiveAgentRun } from '@/lib/agent/run-admission'
import { getActiveAgentRunForSession, requestAgentRunCancellation } from '@/lib/agent/run-store'
import { sessionReleased } from '@/lib/agent/session-released'
import {
  cancelConversationRuntime,
  conversationExecutionState,
} from '@/lib/claude-code-preview/session-execution-state'

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

const RUNTIME_IDLE = new Set(['idle', 'dormant', 'interrupted'])

/**
 * A conversation's Stop. It ends what a waiting message is behind: the
 * runtime's turn, and a run the backend still holds for the session, which a
 * dropped runtime connection can leave without the other. Then the queue goes.
 * History and queued messages stay. False when no turn was running.
 */
export async function stopConversationTurn(conversation: AgentConversation): Promise<boolean> {
  const { userId, sessionId } = conversation
  const idle = RUNTIME_IDLE.has((await conversationExecutionState(conversation)).state)
  const runStopped = await cancelSessionRun(userId, sessionId)

  try {
    await cancelConversationRuntime(conversation)
  } catch (error) {
    if (!runStopped && !idle) throw error
  } finally {
    sessionReleased(userId, sessionId)
  }

  return runStopped || !idle
}
