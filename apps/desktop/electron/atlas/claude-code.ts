import type { AgentProvider } from '../../src/types/runtime'
import { call } from './client'

import type { Team } from './teams'

export async function setTeamAgentRuntime(teamId: string, runtime: AgentProvider): Promise<Team> {
  return call<Team>('PUT', `/teams/${teamId}/agent-runtime`, { runtime }, { retry: false })
}

export type { OpenAbRuntimeStatus } from '../../src/types/team'
