import { AGENT_TURN_START_EVENT } from './constants'
import { appendAgentRunFrame } from './run-frames'
import { uiMessagesToTranscript } from './transcript'

import type { AgentRun } from './types'
import type { UIMessage } from 'ai'

/** The trailing user messages a turn answers. Continuations have none. */
export function turnInputMessages<M extends { role: string }>(messages: readonly M[]): M[] {
  let start = messages.length

  while (start > 0 && messages[start - 1]?.role === 'user') start -= 1

  return messages.slice(start)
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
