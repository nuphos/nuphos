import { callJson, teamQuery } from './http.ts'

export function resolveDecision(
  sessionId: string,
  toolCallId: string,
  teamId?: string,
  resolution: 'answered' | 'dismissed' = 'answered',
  reason?: string,
): Promise<{ ok: boolean; resolved: boolean }> {
  return callJson(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/decisions/${encodeURIComponent(toolCallId)}/resolve${teamQuery(teamId)}`,
    { resolution, ...(reason ? { reason } : {}) },
  )
}

/** The owner allows or rejects a tool call their conversation's turn waits on, outside its panel. */
export function decideToolApproval(
  sessionId: string,
  toolCallId: string,
  teamId: string | undefined,
  decision: 'allow' | 'reject',
): Promise<{ ok: boolean }> {
  return callJson(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/tool-approvals/${encodeURIComponent(toolCallId)}${teamQuery(teamId)}`,
    { decision },
  )
}

/** The owner sets an open question aside until `until` (ISO), or brings it back with null. */
export function snoozeDecision(
  sessionId: string,
  requestId: string,
  teamId: string | undefined,
  until: string | null,
): Promise<{ ok: boolean; snoozedUntil: string | null }> {
  return callJson(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/decisions/${encodeURIComponent(requestId)}/snooze${teamQuery(teamId)}`,
    { until },
  )
}

/** A person's answer to a question: the server wakes the asking agent with it; no message is sent. */
export type DecisionAnswer = {
  choices?: string[]
  text?: string
  questions?: { choices?: string[]; text?: string }[]
  /** Given in the Inbox: its record in the chat says so. */
  answeredIn?: 'inbox'
}

export function answerDecision(
  sessionId: string,
  requestId: string,
  teamId: string | undefined,
  answer: DecisionAnswer,
): Promise<{ ok: boolean }> {
  return callJson(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/decisions/${encodeURIComponent(requestId)}/answer${teamQuery(teamId)}`,
    answer,
  )
}
