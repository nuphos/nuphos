import { AGENT_TURN_START_EVENT } from './constants'
import { appendAgentRunFrame, appendAgentRunPhase } from './run-frames'
import { registerAgentRun } from './run-registry'
import { uiMessagesToTranscript } from './transcript'

import type { AgentRun } from './types'
import type { UIMessage } from 'ai'

/** The trailing user messages a turn answers. Continuations have none. */
export function turnInputMessages<M extends { role: string }>(messages: readonly M[]): M[] {
  let start = messages.length

  while (start > 0 && messages[start - 1]?.role === 'user') start -= 1

  return messages.slice(start)
}

/**
 * The one way a turn's run goes live, whoever started the turn — a chat
 * request, a trigger, a message from another thread. Its first frames carry
 * the input that started it, so a client attaching at any point sees that
 * message before anything the turn produces, as it will in the stored
 * transcript.
 */
export function acceptAgentRun(run: AgentRun, messages: readonly UIMessage[]): void {
  registerAgentRun(run)
  appendAgentRunTurnStart(run, messages)
  appendAgentRunPhase(run, 'request-accepted')
}

export function appendAgentRunTurnStart(run: AgentRun, messages: readonly UIMessage[]): void {
  // Converted as a whole so each message keeps the id the transcript stores.
  const input = turnInputMessages(uiMessagesToTranscript([...messages]))

  if (input.length === 0) return
  appendAgentRunFrame(
    run,
    `data: ${JSON.stringify({ type: AGENT_TURN_START_EVENT, messages: input })}\n\n`,
  )
}
