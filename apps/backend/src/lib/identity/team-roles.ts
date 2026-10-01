import { ObjectId as MongoObjectId } from 'mongodb'

import { teams } from '@/lib/identity/shared'
import { getTeamMembers } from '@/lib/identity/teams'

import type { NuphosTeamMember, NuphosTeamRole } from '@/lib/identity/types'

export type UpdateTeamMemberRoleResult =
  | { kind: 'updated'; member: NuphosTeamMember }
  | { kind: 'team_not_found' }
  | { kind: 'member_not_found' }
  | { kind: 'owner' }
  | { kind: 'self' }
  | { kind: 'forbidden' }
  | { kind: 'last_admin' }

export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: NuphosTeamRole,
  actorUserId: string,
): Promise<UpdateTeamMemberRoleResult> {
  if (
    !MongoObjectId.isValid(teamId) ||
    !MongoObjectId.isValid(userId) ||
    !MongoObjectId.isValid(actorUserId)
  ) {
    return { kind: 'member_not_found' }
  }
  if (userId === actorUserId) {
    return { kind: 'self' }
  }

  const teamObjectId = new MongoObjectId(teamId)
  const userObjectId = new MongoObjectId(userId)
  const actorObjectId = new MongoObjectId(actorUserId)
  const team = await teams().findOne({
    _id: teamObjectId,
    deletedAt: { $exists: false },
  })

  if (!team) return { kind: 'team_not_found' }
  if (team.ownerID.equals(userObjectId)) return { kind: 'owner' }

  const activeMembers = team.members.filter((member) => !member.deletedAt)
  const actor = activeMembers.find((member) => member.userId.equals(actorObjectId))

  if (!actor || actor.role !== 'ADMINISTRATOR') return { kind: 'forbidden' }

  const target = activeMembers.find((member) => member.userId.equals(userObjectId))

  if (!target) return { kind: 'member_not_found' }
  if (target.role === role) {
    const [member] = await getTeamMembers(teamId).then((members) =>
      members.filter((item) => item.id === userId),
    )

    return member ? { kind: 'updated', member } : { kind: 'member_not_found' }
  }

  const activeAdmins = activeMembers.filter((member) => member.role === 'ADMINISTRATOR')

  if (target.role === 'ADMINISTRATOR' && role !== 'ADMINISTRATOR' && activeAdmins.length <= 1) {
    return { kind: 'last_admin' }
  }

  const result = await teams().updateOne(
    {
      _id: teamObjectId,
      deletedAt: { $exists: false },
      members: {
        $elemMatch: {
          userId: userObjectId,
          deletedAt: { $exists: false },
        },
      },
    },
    {
      $set: {
        'members.$.role': role,
        updatedAt: new Date(),
      },
    },
  )

  if (result.modifiedCount === 0) return { kind: 'member_not_found' }
  const [member] = await getTeamMembers(teamId).then((members) =>
    members.filter((item) => item.id === userId),
  )

  return member ? { kind: 'updated', member } : { kind: 'member_not_found' }
}
