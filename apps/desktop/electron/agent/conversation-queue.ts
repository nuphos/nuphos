import { callJson, teamQuery } from './http'

/** Take a waiting message back from the session queue (sender only); 404 once it started. */
export async function unqueueMessage(
  sessionId: string,
  messageId: string,
  teamId?: string,
): Promise<{ ok: boolean; text: string }> {
  return callJson<{ ok: boolean; text: string }>(
    'DELETE',
    `/agent/conversations/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(messageId)}${teamQuery(teamId)}`,
  )
}
