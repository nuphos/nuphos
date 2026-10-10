import { callJsonForRenderer, teamQuery } from './http'

import type { SessionResourcesResponse } from '../../src/api/session-resource-types'

export function getSessionResources(
  sessionId: string,
  teamId: string,
): Promise<SessionResourcesResponse> {
  return callJsonForRenderer(
    'GET',
    `/agent/conversations/${encodeURIComponent(sessionId)}/resources${teamQuery(teamId)}`,
    undefined,
    12_000,
  )
}

export function unlinkSessionResource(
  sessionId: string,
  teamId: string,
  resourceId: string,
): Promise<{ ok: boolean }> {
  return callJsonForRenderer(
    'DELETE',
    `/agent/conversations/${encodeURIComponent(sessionId)}/resources/${encodeURIComponent(resourceId)}${teamQuery(teamId)}`,
    undefined,
    12_000,
  )
}
