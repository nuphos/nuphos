import { ObjectId as MongoObjectId } from 'mongodb'

import { teams } from '@/lib/identity/shared'

export type RemoveUserFromTeamResult =
  'removed' | 'team_not_found' | 'member_not_found' | 'owner' | 'self' | 'forbidden' | 'last_admin'

export async function removeUserFromTeam(
  teamId: string,
  userId: string,
  actorUserId: string,
): Promise<RemoveUserFromTeamResult> {
  if (
    !MongoObjectId.isValid(teamId) ||
    !MongoObjectId.isValid(userId) ||
    !MongoObjectId.isValid(actorUserId)
  ) {
    return 'member_not_found'
  }
  if (userId === actorUserId) {
    return 'self'
  }

  const teamObjectId = new MongoObjectId(teamId)
  const userObjectId = new MongoObjectId(userId)
  const team = await teams().findOne({
    _id: teamObjectId,
    deletedAt: { $exists: false },
  })

  if (!team) return 'team_not_found'
  if (team.ownerID.equals(userObjectId)) return 'owner'

  const activeMembers = team.members.filter((member) => !member.deletedAt)
  const actorObjectId = new MongoObjectId(actorUserId)
  const actor = activeMembers.find((member) => member.userId.equals(actorObjectId))

  if (!actor || actor.role !== 'ADMINISTRATOR') return 'forbidden'

  const target = activeMembers.find((member) => member.userId.equals(userObjectId))

  if (!target) return 'member_not_found'

  const activeAdmins = activeMembers.filter((member) => member.role === 'ADMINISTRATOR')

  if (target.role === 'ADMINISTRATOR' && activeAdmins.length <= 1) {
    return 'last_admin'
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
        'members.$.deletedAt': new Date(),
        updatedAt: new Date(),
      },
    },
  )

  return result.modifiedCount > 0 ? 'removed' : 'member_not_found'
}

export type DeleteTeamResult = 'deleted' | 'team_not_found' | 'forbidden'

/**
 * Soft-delete a whole team (disband). Owner-only. Sets the team-level
 * `deletedAt`, after which every membership/query filter
 * (`deletedAt: { $exists: false }`) excludes it, so the team disappears for all
 * members.
 */
export async function deleteTeam(teamId: string, actorUserId: string): Promise<DeleteTeamResult> {
  if (!MongoObjectId.isValid(teamId) || !MongoObjectId.isValid(actorUserId)) {
    return 'team_not_found'
  }

  const teamObjectId = new MongoObjectId(teamId)
  const actorObjectId = new MongoObjectId(actorUserId)
  const team = await teams().findOne({
    _id: teamObjectId,
    deletedAt: { $exists: false },
  })

  if (!team) return 'team_not_found'
  if (!team.ownerID.equals(actorObjectId)) return 'forbidden'

  const result = await teams().updateOne(
    { _id: teamObjectId, deletedAt: { $exists: false } },
    { $set: { deletedAt: new Date(), updatedAt: new Date() } },
  )

  return result.modifiedCount > 0 ? 'deleted' : 'team_not_found'
}

export type LeaveTeamResult =
  'left' | 'team_not_found' | 'member_not_found' | 'owner' | 'last_admin'

/**
 * Soft-leave a team: the acting user removes their own membership. The owner
 * can't leave (they must delete the team or transfer ownership first), and the
 * last remaining admin can't leave — mirrors the guards in removeUserFromTeam,
 * only self-scoped.
 */
export async function leaveTeam(teamId: string, actorUserId: string): Promise<LeaveTeamResult> {
  if (!MongoObjectId.isValid(teamId) || !MongoObjectId.isValid(actorUserId)) {
    return 'member_not_found'
  }

  const teamObjectId = new MongoObjectId(teamId)
  const actorObjectId = new MongoObjectId(actorUserId)
  const team = await teams().findOne({
    _id: teamObjectId,
    deletedAt: { $exists: false },
  })

  if (!team) return 'team_not_found'
  if (team.ownerID.equals(actorObjectId)) return 'owner'

  const activeMembers = team.members.filter((member) => !member.deletedAt)
  const self = activeMembers.find((member) => member.userId.equals(actorObjectId))

  if (!self) return 'member_not_found'

  const activeAdmins = activeMembers.filter((member) => member.role === 'ADMINISTRATOR')

  if (self.role === 'ADMINISTRATOR' && activeAdmins.length <= 1) {
    return 'last_admin'
  }

  // Close the check-then-write race: an admin is only removed if the write
  // itself still sees more than one active admin, so two admins leaving
  // concurrently can't both clear the in-memory guard and strand the team
  // with zero admins.
  const lastAdminGuard =
    self.role === 'ADMINISTRATOR'
      ? {
          $expr: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: '$members',
                    as: 'm',
                    cond: {
                      $and: [{ $eq: ['$$m.role', 'ADMINISTRATOR'] }, { $not: ['$$m.deletedAt'] }],
                    },
                  },
                },
              },
              1,
            ],
          },
        }
      : {}

  const result = await teams().updateOne(
    {
      _id: teamObjectId,
      deletedAt: { $exists: false },
      members: {
        $elemMatch: {
          userId: actorObjectId,
          deletedAt: { $exists: false },
        },
      },
      ...lastAdminGuard,
    },
    {
      $set: {
        'members.$.deletedAt': new Date(),
        updatedAt: new Date(),
      },
    },
  )

  if (result.modifiedCount > 0) return 'left'

  // The member was active moments ago, so a zero-match write means a
  // concurrent change won the race: for an admin that's the atomic last-admin
  // guard firing, otherwise the membership was already removed.
  return self.role === 'ADMINISTRATOR' ? 'last_admin' : 'member_not_found'
}
