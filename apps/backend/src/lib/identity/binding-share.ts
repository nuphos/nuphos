import { ObjectId as MongoObjectId } from 'mongodb'

import { upsertCachedTeam } from '@/lib/agent/directory'
import { mapTeam, teams } from '@/lib/identity/shared'

import type { BindingShareDefault, NuphosTeam } from '@/lib/identity/types'

export async function setTeamBindingShareDefault(
  teamId: string,
  share: BindingShareDefault,
): Promise<NuphosTeam | null> {
  if (!MongoObjectId.isValid(teamId)) return null
  const result = await teams().findOneAndUpdate(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    { $set: { bindingShareDefault: share, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!result) return null
  const mapped = mapTeam(result)

  upsertCachedTeam(mapped)

  return mapped
}
