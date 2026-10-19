import { callJson, teamQuery } from './http'

/** Whether this user gets the chat's push notifications. Unwatching also
 *  unwatches the threads nested below it. */
export async function setConversationWatched(
  sessionId: string,
  watching: boolean,
  teamId?: string,
): Promise<{ ok: boolean; watching: boolean }> {
  return callJson<{ ok: boolean; watching: boolean }>(
    watching ? 'PUT' : 'DELETE',
    `/agent/conversations/${encodeURIComponent(sessionId)}/watch${teamQuery(teamId)}`,
  )
}
