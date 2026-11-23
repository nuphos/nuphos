import { callJson, callJsonForRenderer, teamQuery } from './http'

export async function unlinkConversationParent(
  sessionId: string,
  teamId?: string,
): Promise<{ ok: boolean }> {
  return callJson<{ ok: boolean }>(
    'DELETE',
    `/agent/conversations/${encodeURIComponent(sessionId)}/parent${teamQuery(teamId)}`,
  )
}

/** Leave a line in a conversation that one of its messages was edited and ran in `forkSessionId`. */
export async function recordEditFork(
  sessionId: string,
  forkSessionId: string,
  teamId?: string,
): Promise<{ ok: boolean }> {
  return callJsonForRenderer<{ ok: boolean }>(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/edit-forks${teamQuery(teamId)}`,
    { forkSessionId },
  )
}

/** Link a stored fork from its source conversation. */
export async function recordFork(
  sessionId: string,
  forkSessionId: string,
  teamId?: string,
): Promise<{ ok: boolean }> {
  return callJsonForRenderer<{ ok: boolean }>(
    'POST',
    `/agent/conversations/${encodeURIComponent(sessionId)}/forks${teamQuery(teamId)}`,
    { forkSessionId },
  )
}
