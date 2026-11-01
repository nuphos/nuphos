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
