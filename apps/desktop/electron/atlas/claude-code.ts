import { call } from './client'

import type { Team } from './teams'

export async function setTeamAgentRuntime(
  teamId: string,
  runtime: 'claude-code' | 'codex',
): Promise<Team> {
  return call<Team>('PUT', `/teams/${teamId}/agent-runtime`, { runtime }, { retry: false })
}

export type { OpenAbRuntimeStatus } from '../../src/types/team'
