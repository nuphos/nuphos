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
