import { callJsonForRenderer, teamQuery } from './http.ts'

export function resolveDecision(
  sessionId: string,
  toolCallId: string,
  teamId?: string,
  resolution: 'answered' | 'dismissed' = 'answered',
): Promise<{ ok: boolean; resolved: boolean }> {
  return callJsonForRenderer(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/decisions/${encodeURIComponent(toolCallId)}/resolve${teamQuery(teamId)}`,
    { resolution },
  )
}

/** A person's answer to a question: the server wakes the asking agent with it; no message is sent. */
export type DecisionAnswer = {
  choices?: string[]
  text?: string
  questions?: { choices?: string[]; text?: string }[]
}

export function answerDecision(
  sessionId: string,
  requestId: string,
  teamId: string | undefined,
  answer: DecisionAnswer,
): Promise<{ ok: boolean }> {
  return callJsonForRenderer(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/decisions/${encodeURIComponent(requestId)}/answer${teamQuery(teamId)}`,
    answer,
  )
}
