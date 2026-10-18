import { callJson, teamQuery } from './http'

export type QueuedConversationMessage = {
  id: string
  source: string
  senderUserId: string
  mine: boolean
  text: string
  receivedAt: string
  streamId?: string
}

/** What waits in the session queue, in the order it runs. */
export async function listConversationQueue(
  sessionId: string,
  teamId?: string,
): Promise<{ messages: QueuedConversationMessage[] }> {
  return callJson<{ messages: QueuedConversationMessage[] }>(
    'GET',
    `/agent/conversations/${encodeURIComponent(sessionId)}/queue${teamQuery(teamId)}`,
  )
}

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
