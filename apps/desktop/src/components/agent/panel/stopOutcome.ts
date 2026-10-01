import { track } from '../../../lib/analytics'
import { toast } from '../../ui/toast'

import { settleStopOutcome } from './stopOutcomeLogic'

import type { StopOutcome } from './stopOutcomeLogic'

/**
 * Stop the turn server-side and tell the user when that did not work.
 *
 * Clearing the tab is instant and local; this is the other half, and it used to
 * be a fire-and-forget POST inside an empty catch.
 */
export async function reportStopOutcome(args: {
  sessionId: string
  streamId: string
  teamId?: string
}): Promise<StopOutcome> {
  const outcome = await settleStopOutcome(args, {
    abort: (streamId) => window.api.agentAbort(streamId),
    getActiveStreamId: async (sessionId, teamId) => {
      const detail = await window.api.agentGetConversation(sessionId, teamId, { tail: 1 })

      return detail.activeRun?.streamId ?? null
    },
    wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  })

  if (outcome.kind === 'stopped') return outcome
  track('agent_response_stop_failed', { status: outcome.status, phase: outcome.kind })
  if (outcome.kind === 'still_running') {
    toast.error(
      'The agent turn is still running on the server',
      'The turn is still active after several stop checks. Try reopening the conversation before sending another message.',
    )

    return outcome
  }
  toast.error(
    'Could not stop the turn on the server',
    'The stop request did not reach the server. Your next message may be refused while the turn is still running.',
  )

  return outcome
}
