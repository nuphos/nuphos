import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'

type TeamMembershipDoc = {
  members: { userId: ObjectId; deletedAt?: Date }[]
}

/** Local agents and local exec follow their owner into any team they currently belong to. */
export async function isActiveTeamMember(userId: string, teamId: string): Promise<boolean> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(teamId)) return false
  const userObjectId = new ObjectId(userId)
  const team = await db()
    .collection<TeamMembershipDoc>('teams')
    .findOne(
      { _id: new ObjectId(teamId), deletedAt: { $exists: false } },
      { projection: { members: 1 } },
    )

  return Boolean(team?.members.some((m) => m.userId.equals(userObjectId) && !m.deletedAt))
}
