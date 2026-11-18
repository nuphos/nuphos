import { ObjectId as MongoObjectId } from 'mongodb'

import { upsertCachedTeam } from '@/lib/agent/directory'
import { mapTeam, teams } from '@/lib/identity/shared'

import type { NuphosTeam } from '@/lib/identity/types'

/** Whether the team's Boxes update on their own (box-update); on unless the team turned it off. */
export async function getTeamBoxAutoUpdate(teamId: string): Promise<boolean> {
  if (!MongoObjectId.isValid(teamId)) return true
  const team = await teams().findOne(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    { projection: { boxAutoUpdate: 1 } },
  )

  return team?.boxAutoUpdate !== false
}

export async function setTeamBoxAutoUpdate(
  teamId: string,
  enabled: boolean,
): Promise<NuphosTeam | null> {
  if (!MongoObjectId.isValid(teamId)) return null
  const result = await teams().findOneAndUpdate(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    enabled
      ? { $unset: { boxAutoUpdate: '' }, $set: { updatedAt: new Date() } }
      : { $set: { boxAutoUpdate: false, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!result) return null
  const mapped = mapTeam(result)

  upsertCachedTeam(mapped)

  return mapped
}
