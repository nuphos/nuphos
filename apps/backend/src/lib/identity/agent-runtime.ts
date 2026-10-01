import { ObjectId as MongoObjectId } from 'mongodb'

import { upsertCachedTeam } from '@/lib/agent/directory'
import { mapTeam, teams } from '@/lib/identity/shared'

import type { NuphosTeam } from '@/lib/identity/types'

export type TeamAgentRuntime = 'claude-code' | 'codex'

export const DEFAULT_TEAM_AGENT_RUNTIME: TeamAgentRuntime = 'claude-code'

export async function setTeamAgentRuntime(
  teamId: string,
  runtime: TeamAgentRuntime,
): Promise<NuphosTeam | null> {
  if (!MongoObjectId.isValid(teamId)) return null
  const result = await teams().findOneAndUpdate(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    { $set: { agentRuntime: runtime, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!result) return null
  const mapped = mapTeam(result)

  upsertCachedTeam(mapped)

  return mapped
}

export async function getTeamAgentRuntime(teamId: string): Promise<TeamAgentRuntime> {
  if (!MongoObjectId.isValid(teamId)) return DEFAULT_TEAM_AGENT_RUNTIME
  const team = await teams().findOne(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    { projection: { agentRuntime: 1 } },
  )

  return team?.agentRuntime === 'codex' ? 'codex' : DEFAULT_TEAM_AGENT_RUNTIME
}
