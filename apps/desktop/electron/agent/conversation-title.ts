import { callJson, teamQuery } from './http'

export async function renameConversation(
  sessionId: string,
  title: string,
  teamId?: string,
): Promise<{ title: string }> {
  return callJson(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(sessionId)}/title${teamQuery(teamId)}`,
    { title },
  )
}
