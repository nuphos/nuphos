import { ObjectId as MongoObjectId } from 'mongodb'

import { upsertCachedTeam } from '@/lib/agent/directory'
import { mapTeam, teams } from '@/lib/identity/shared'

import { localShareCeiling } from './local-share-types'

import type { LocalShareLevel } from './local-share-types'
import type { NuphosTeam } from '@/lib/identity/types'

/** The most an owner in this team may grant on their own computer. */
export async function getTeamLocalAgentSharing(teamId: string): Promise<LocalShareLevel> {
  if (!MongoObjectId.isValid(teamId)) return 'off'
  const team = await teams().findOne(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    { projection: { localAgentSharing: 1 } },
  )

  return team ? localShareCeiling(team.localAgentSharing) : 'off'
}

export async function setTeamLocalAgentSharing(
  teamId: string,
  level: LocalShareLevel,
): Promise<NuphosTeam | null> {
  if (!MongoObjectId.isValid(teamId)) return null
  const result = await teams().findOneAndUpdate(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    { $set: { localAgentSharing: level, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!result) return null
  const mapped = mapTeam(result)

  upsertCachedTeam(mapped)

  return mapped
}
