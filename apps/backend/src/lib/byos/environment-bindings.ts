import { MongoServerError, ObjectId } from 'mongodb'

import { parseObjectId } from '@/lib/objectid'
import { emptyTeamByosBindings, teamByosBindings } from '@/models'

import type { TeamByosBindings } from '@/models/team'
import type { Filter, UpdateFilter } from 'mongodb'

export async function appendEnvironmentBinding(
  teamIdInput: string | ObjectId,
  duplicateFilter: Filter<TeamByosBindings>,
  update: UpdateFilter<TeamByosBindings>,
): Promise<boolean> {
  const teamId =
    teamIdInput instanceof ObjectId ? teamIdInput : parseObjectId(teamIdInput, 'teamId')

  try {
    await teamByosBindings().updateOne(
      { _id: teamId },
      { $setOnInsert: { ...emptyTeamByosBindings(), updatedAt: new Date() } },
      { upsert: true },
    )
  } catch (err) {
    // Two first-ever bindings may race to create the same team document. The
    // winner created exactly the document the loser needs, so retry the append.
    if (!(err instanceof MongoServerError) || err.code !== 11000) throw err
  }

  const result = await teamByosBindings().updateOne({ _id: teamId, ...duplicateFilter }, update)

  return result.modifiedCount > 0
}
