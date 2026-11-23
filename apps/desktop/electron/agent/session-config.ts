import { callJson, callJsonForRenderer, teamQuery } from './http'

import type { SessionConfigSelection, SessionConfigState } from '../../src/api/session-config-types'

export function getSessionConfig(sessionId: string, teamId: string): Promise<SessionConfigState> {
  return callJson(
    'GET',
    `/agent/conversations/${encodeURIComponent(sessionId)}/model-config${teamQuery(teamId)}`,
    undefined,
    12_000,
  )
}

export function setSessionConfig(
  sessionId: string,
  teamId: string,
  selection: SessionConfigSelection,
): Promise<SessionConfigState> {
  // The picker tells the user why a change was refused, so the backend's own
  // message and code have to survive the IPC boundary (callJson alone keeps
  // them as properties, which IPC strips).
  return callJsonForRenderer(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(sessionId)}/model-config${teamQuery(teamId)}`,
    selection,
    35_000,
  )
}
