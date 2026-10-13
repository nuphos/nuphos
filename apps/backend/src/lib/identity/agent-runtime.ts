import { ObjectId as MongoObjectId } from 'mongodb'

import { upsertCachedTeam } from '@/lib/agent/directory'
import { runtimeProvider } from '@/lib/claude-code-preview/runtime-provider'
import { mapTeam, teams } from '@/lib/identity/shared'

import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'
import type { NuphosTeam } from '@/lib/identity/types'

export type TeamAgentRuntime = OpenAbProvider

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

  return runtimeProvider(team?.agentRuntime)
}
