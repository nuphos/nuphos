import { callJson, teamQuery } from './http'

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
  return callJson(
    'PATCH',
    `/agent/conversations/${encodeURIComponent(sessionId)}/model-config${teamQuery(teamId)}`,
    selection,
    35_000,
  )
}
