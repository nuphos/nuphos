import { callJson, teamQuery } from './http'

/** Stop the turn of the caller's just-sent message and drop the message. */
export function retractMessage(
  sessionId: string,
  messageId: string,
  teamId?: string,
): Promise<{ ok: boolean }> {
  return callJson(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/retract${teamQuery(teamId)}`,
    {},
    30_000,
  )
}
