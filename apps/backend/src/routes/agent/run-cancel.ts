import { getLocalActiveAgentRun } from '@/lib/agent/run-admission'
import { getActiveAgentRunForSession, requestAgentRunCancellation } from '@/lib/agent/run-store'

import { agentRunKey, agentRuns } from './run-registry'

import type { AgentRun } from './types'

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
