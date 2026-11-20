import { MongoServerError, ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { emptyTeamByosBindings, teamByosBindings } from '@/models'

import type { BindingCollection } from '@/lib/byos/access-routes'
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

/**
 * `appendEnvironmentBinding` for a bind whose `check` reads the team's other
 * bindings, such as refusing an identity another member holds privately. The
 * append applies only while they are exactly the ones checked, re-checking
 * when another write got in between, so two concurrent binds can't both pass.
 */
export async function appendCheckedBinding<K extends BindingCollection>(
  teamId: ObjectId,
  collection: K,
  check: (bindings: NonNullable<TeamByosBindings[K]>) => void | Promise<void>,
  duplicateFilter: Filter<TeamByosBindings>,
  update: UpdateFilter<TeamByosBindings>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { [collection]: 1 } },
    )
    const seen = doc?.[collection]

    await check((seen ?? []) as NonNullable<TeamByosBindings[K]>)
    // The append matches only while the bindings are exactly the ones checked.
    const unchanged = {
      $and: [duplicateFilter, { [collection]: seen ?? { $exists: false } }],
    }

    if (await appendEnvironmentBinding(teamId, unchanged, update)) return true
    // A duplicate is the route's to answer; anything else changed, so check again.
    if (!(await teamByosBindings().countDocuments({ _id: teamId, ...duplicateFilter })))
      return false
  }
  throw new AppError(
    409,
    'bindings_changed',
    "The team's connections kept changing while this one was being added. Try again.",
  )
}
