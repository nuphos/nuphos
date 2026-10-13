import { callJson, teamQuery } from './http'

export async function unlinkConversationParent(
  sessionId: string,
  teamId?: string,
): Promise<{ ok: boolean }> {
  return callJson<{ ok: boolean }>(
    'DELETE',
    `/agent/conversations/${encodeURIComponent(sessionId)}/parent${teamQuery(teamId)}`,
  )
}
