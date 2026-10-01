import { ObjectId as MongoObjectId } from 'mongodb'

import { upsertCachedTeam } from '@/lib/agent/directory'
import { mapTeam, mapUser, teams, users } from '@/lib/identity/shared'

import type { NuphosTeamDoc } from '@/lib/identity/shared'
import type {
  NuphosTeam,
  NuphosTeamMember,
  NuphosTeamRole,
  TeamMembership,
  TeamUpdateInput,
} from '@/lib/identity/types'
import type { Filter } from 'mongodb'

export async function getTeamMembership(
  userId: string,
  teamId: string,
): Promise<TeamMembership | null> {
  return getNuphosTeamMembership(userId, teamId)
}

export async function getMyTeams(userId: string): Promise<NuphosTeam[]> {
  const userObjectId = new MongoObjectId(userId)
  const docs = await teams()
    .find({
      deletedAt: { $exists: false },
      members: {
        $elemMatch: {
          userId: userObjectId,
          deletedAt: { $exists: false },
        },
      },
    })
    .sort({ createdAt: 1 })
    .toArray()

  return docs.map((doc) => {
    const role = doc.members.find(
      (member) => member.userId.equals(userObjectId) && !member.deletedAt,
    )?.role

    return { ...mapTeam(doc), role }
  })
}

export async function getTeamsByIds(teamIds: string[]): Promise<NuphosTeam[]> {
  const ids = teamIds
    .filter((teamId) => MongoObjectId.isValid(teamId))
    .map((teamId) => new MongoObjectId(teamId))

  if (ids.length === 0) return []
  const docs = await teams()
    .find({
      _id: { $in: ids },
      deletedAt: { $exists: false },
    })
    .toArray()

  return docs.map(mapTeam)
}

export async function createTeamForUser(userId: string, name: string): Promise<NuphosTeam> {
  const teamName = name.trim()

  if (!teamName) {
    throw new Error('Team name is required')
  }
  if (teamName.length > 80) {
    throw new Error('Team name is too long')
  }

  if (!MongoObjectId.isValid(userId)) {
    throw new Error('Invalid userId')
  }
  const userObjectId = new MongoObjectId(userId)
  const user = await users().findOne({
    _id: userObjectId,
    deletedAt: { $exists: false },
  })

  if (!user) {
    throw new Error('User not found')
  }

  const now = new Date()
  // The seeded membership is the single source of the role echoed back to the
  // caller — derived, not restated, so a change to the seeding rule can never
  // make the response disagree with what was persisted.
  const creator = { userId: user._id, role: 'ADMINISTRATOR' as const, joinedAt: now }
  const team: NuphosTeamDoc = {
    _id: new MongoObjectId(),
    name: teamName,
    avatarUrl: '',
    ownerID: user._id,
    contactEmails: [user.email],
    members: [creator],
    createdAt: now,
    updatedAt: now,
  }

  await teams().insertOne(team)
  const mapped = mapTeam(team)

  upsertCachedTeam(mapped)

  return { ...mapped, role: creator.role }
}

export async function updateTeam(
  teamId: string,
  actorUserId: string,
  input: TeamUpdateInput,
): Promise<NuphosTeam | null> {
  if (!MongoObjectId.isValid(teamId) || !MongoObjectId.isValid(actorUserId)) {
    return null
  }

  const teamObjectId = new MongoObjectId(teamId)
  const actorObjectId = new MongoObjectId(actorUserId)
  const team = await teams().findOne({
    _id: teamObjectId,
    deletedAt: { $exists: false },
  })

  if (!team) return null
  const actor = team.members.find(
    (member) => member.userId.equals(actorObjectId) && !member.deletedAt,
  )

  if (!actor || (actor.role !== 'ADMINISTRATOR' && actor.role !== 'EDITOR')) {
    throw new Error('Requires team editor')
  }

  const update: Partial<Pick<NuphosTeamDoc, 'name' | 'avatarUrl' | 'updatedAt'>> = {
    updatedAt: new Date(),
  }

  if (input.name !== undefined) update.name = input.name.trim()
  if (input.avatarUrl !== undefined) update.avatarUrl = input.avatarUrl.trim()

  const result = await teams().findOneAndUpdate(
    { _id: teamObjectId, deletedAt: { $exists: false } },
    { $set: update },
    { returnDocument: 'after' },
  )

  if (!result) return null
  const mapped = mapTeam(result)

  upsertCachedTeam(mapped)

  return mapped
}

export async function addUserToTeam(
  teamId: string,
  userId: string,
  role: NuphosTeamRole = 'EDITOR',
): Promise<boolean> {
  if (!MongoObjectId.isValid(teamId) || !MongoObjectId.isValid(userId)) {
    throw new Error('Invalid teamId or userId')
  }
  const userObjectId = new MongoObjectId(userId)
  const teamObjectId = new MongoObjectId(teamId)
  const user = await users().findOne({
    _id: userObjectId,
    deletedAt: { $exists: false },
  })

  if (!user) return false

  const filter: Filter<NuphosTeamDoc> = {
    _id: teamObjectId,
    deletedAt: { $exists: false },
    members: {
      $not: {
        $elemMatch: {
          userId: userObjectId,
          deletedAt: { $exists: false },
        },
      },
    },
  }

  const result = await teams().updateOne(filter, {
    $push: {
      members: {
        userId: userObjectId,
        role,
        joinedAt: new Date(),
      },
    },
    $set: { updatedAt: new Date() },
  })

  return result.modifiedCount > 0
}

/** Active (non-tombstoned) member count. */
export async function countActiveTeamMembers(teamId: string): Promise<number> {
  if (!MongoObjectId.isValid(teamId)) return 0
  const team = await teams().findOne(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    { projection: { members: 1 } },
  )

  return team?.members.filter((member) => !member.deletedAt).length ?? 0
}

export async function getTeamMembers(
  teamId: string,
  opts?: { includeRemoved?: boolean },
): Promise<NuphosTeamMember[]> {
  if (!MongoObjectId.isValid(teamId)) return []
  const team = await teams().findOne({
    _id: new MongoObjectId(teamId),
    deletedAt: { $exists: false },
  })

  if (!team) return []

  // Removed members are soft-deleted (membership tombstoned with `deletedAt`),
  // never hard-deleted — so callers that need historical attribution (e.g. the
  // plan creator of a since-removed member) can opt in to see them, flagged
  // with `removedAt`, while the default stays active-only for roster views.
  const selectedMembers = opts?.includeRemoved
    ? team.members
    : team.members.filter((member) => !member.deletedAt)
  const userIds = selectedMembers.map((member) => member.userId)
  const userDocs = await users()
    .find({ _id: { $in: userIds }, deletedAt: { $exists: false } })
    .toArray()
  const userById = new Map(userDocs.map((user) => [user._id.toHexString(), user]))

  return selectedMembers.flatMap((member) => {
    const user = userById.get(member.userId.toHexString())

    if (!user) return []

    return [
      {
        ...mapUser(user),
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        ...(member.deletedAt ? { removedAt: member.deletedAt.toISOString() } : {}),
      },
    ]
  })
}

async function getNuphosTeamMembership(
  userId: string,
  teamId: string,
): Promise<TeamMembership | null> {
  if (!MongoObjectId.isValid(userId) || !MongoObjectId.isValid(teamId)) return null
  const userObjectId = new MongoObjectId(userId)
  const team = await teams().findOne({
    _id: new MongoObjectId(teamId),
    deletedAt: { $exists: false },
    members: {
      $elemMatch: {
        userId: userObjectId,
        deletedAt: { $exists: false },
      },
    },
  })

  if (!team) return null
  const member = team.members.find((m) => m.userId.equals(userObjectId) && !m.deletedAt)

  if (!member) return null
  const mapped = mapTeam(team)

  upsertCachedTeam(mapped)

  return { role: member.role, team: mapped }
}
