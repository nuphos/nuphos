import { ObjectId as MongoObjectId } from 'mongodb'

import { upsertCachedTeam } from '@/lib/agent/directory'
import { extractEmailDomain, isPublicEmailDomain } from '@/lib/email-domains'
import { mapTeam, teams, users } from '@/lib/identity/shared'
import { addUserToTeam } from '@/lib/identity/teams'

import type { NuphosTeamDoc } from '@/lib/identity/shared'
import type { NuphosTeam } from '@/lib/identity/types'
import type { ObjectId } from 'mongodb'

export async function setTeamAllowedEmailDomains(
  teamId: string,
  domains: string[],
): Promise<NuphosTeam | null> {
  if (!MongoObjectId.isValid(teamId)) return null
  const result = await teams().findOneAndUpdate(
    { _id: new MongoObjectId(teamId), deletedAt: { $exists: false } },
    { $set: { allowedEmailDomains: domains, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!result) return null
  const mapped = mapTeam(result)

  upsertCachedTeam(mapped)

  return mapped
}

export type DiscoverableTeam = {
  id: string
  name: string
  avatarUrl: string
  memberCount: number
  /** Up to a handful of member names/avatars for the join UI's facepile. */
  memberPreviews: { name: string; avatarURL: string }[]
}

const DISCOVERABLE_MEMBER_PREVIEWS = 5

// Teams that advertise the user's email domain and that the user is not
// already an active member of. Public mailbox domains never match — they are
// rejected at write time too, but guard here so a stale document can't leak.
export async function getDiscoverableTeamsForEmail(
  userId: string,
  email: string,
): Promise<DiscoverableTeam[]> {
  if (!MongoObjectId.isValid(userId)) return []
  const domain = extractEmailDomain(email)

  if (!domain || isPublicEmailDomain(domain)) return []
  const userObjectId = new MongoObjectId(userId)
  const docs = await teams()
    .find({
      deletedAt: { $exists: false },
      allowedEmailDomains: domain,
      members: {
        $not: {
          $elemMatch: {
            userId: userObjectId,
            deletedAt: { $exists: false },
          },
        },
      },
    })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray()

  const activeMembersByTeam = new Map(
    docs.map((doc) => [doc._id.toHexString(), doc.members.filter((member) => !member.deletedAt)]),
  )
  const previewUserIds = [...activeMembersByTeam.values()].flatMap((members) =>
    members.slice(0, DISCOVERABLE_MEMBER_PREVIEWS).map((member) => member.userId),
  )
  const previewUsers = previewUserIds.length
    ? await users()
        .find({ _id: { $in: previewUserIds }, deletedAt: { $exists: false } })
        .toArray()
    : []
  const previewUserById = new Map(previewUsers.map((user) => [user._id.toHexString(), user]))

  return docs.map((doc) => {
    const activeMembers = activeMembersByTeam.get(doc._id.toHexString()) ?? []

    return {
      id: doc._id.toHexString(),
      name: doc.name,
      avatarUrl: doc.avatarUrl,
      memberCount: activeMembers.length,
      memberPreviews: activeMembers.slice(0, DISCOVERABLE_MEMBER_PREVIEWS).flatMap((member) => {
        const user = previewUserById.get(member.userId.toHexString())

        return user ? [{ name: user.name, avatarURL: user.avatarURL }] : []
      }),
    }
  })
}

export type JoinTeamByEmailDomainResult =
  | { kind: 'joined'; team: NuphosTeam }
  | { kind: 'team_not_found' }
  | { kind: 'not_allowed' }
  | { kind: 'already_member' }

function classifyFailedJoin(
  team: NuphosTeamDoc | null,
  userObjectId: ObjectId,
): Exclude<JoinTeamByEmailDomainResult, { kind: 'joined' }> {
  if (!team) return { kind: 'team_not_found' }
  if (team.members.some((member) => member.userId.equals(userObjectId) && !member.deletedAt)) {
    return { kind: 'already_member' }
  }

  return { kind: 'already_member' }
}

export async function joinTeamByEmailDomain(
  teamId: string,
  userId: string,
  email: string,
): Promise<JoinTeamByEmailDomainResult> {
  if (!MongoObjectId.isValid(teamId) || !MongoObjectId.isValid(userId)) {
    return { kind: 'team_not_found' }
  }
  const domain = extractEmailDomain(email)

  if (!domain || isPublicEmailDomain(domain)) return { kind: 'not_allowed' }

  const team = await teams().findOne({
    _id: new MongoObjectId(teamId),
    deletedAt: { $exists: false },
  })

  if (!team) return { kind: 'team_not_found' }
  if (!(team.allowedEmailDomains ?? []).includes(domain)) return { kind: 'not_allowed' }

  const userObjectId = new MongoObjectId(userId)
  const isActiveMember = team.members.some(
    (member) => member.userId.equals(userObjectId) && !member.deletedAt,
  )

  if (isActiveMember) return { kind: 'already_member' }

  // addUserToTeam only pushes when no active membership exists, so a
  // concurrent join deduplicates here rather than double-inserting. It only
  // reports success/failure, though, so distinguish "lost the race to another
  // join" from "team was deleted meanwhile".
  const added = await addUserToTeam(teamId, userId, 'EDITOR')

  if (!added) {
    const still = await teams().findOne({
      _id: new MongoObjectId(teamId),
      deletedAt: { $exists: false },
    })

    return classifyFailedJoin(still, userObjectId)
  }
  const joined = await teams().findOne({
    _id: new MongoObjectId(teamId),
    deletedAt: { $exists: false },
  })

  if (!joined) return { kind: 'team_not_found' }

  return { kind: 'joined', team: mapTeam(joined) }
}
