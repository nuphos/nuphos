import { teams } from '@/lib/identity/shared'

import type { ObjectId } from 'mongodb'

/** The ids of the team's current members. A member who left is kept with `deletedAt`. */
export async function currentMemberIds(teamId: ObjectId): Promise<Set<string>> {
  const team = await teams().findOne({ _id: teamId }, { projection: { members: 1 } })

  return new Set(
    (team?.members ?? [])
      .filter((member) => !member.deletedAt)
      .map((member) => member.userId.toHexString()),
  )
}
