import { ObjectId as MongoObjectId } from 'mongodb'

import { getLastActiveByTeam, getLastActiveByUser } from '@/lib/agent/db'
import { escapeRegExp, mapTeam, mapUser, teams, users } from '@/lib/identity/shared'
import { getMyTeams } from '@/lib/identity/teams'

import type { NuphosTeam, NuphosTeamRole, NuphosUser } from '@/lib/identity/types'

export type DirectoryUserMatch = {
  id: string
  email: string
  name: string
  username: string
  avatarURL: string
}

export type DirectoryTeamMatch = {
  id: string
  name: string
  avatarUrl: string
  contactEmails: string[]
}

export async function searchUsersDirectory(q: string, limit = 8): Promise<DirectoryUserMatch[]> {
  const re = new RegExp(escapeRegExp(q), 'i')
  const clauses: Record<string, unknown>[] = [{ email: re }, { name: re }, { username: re }]

  if (/^[0-9a-f]{4,24}$/i.test(q)) {
    clauses.push({
      $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `^${q.toLowerCase()}` } },
    })
  }
  const docs = await users()
    .find({ deletedAt: { $exists: false }, $or: clauses })
    .limit(limit)
    .toArray()

  return docs.map((doc) => ({
    id: doc._id.toString(),
    email: doc.email ?? '',
    name: doc.name ?? '',
    username: doc.username ?? '',
    avatarURL: doc.avatarURL ?? '',
  }))
}

export async function searchTeamsDirectory(q: string, limit = 8): Promise<DirectoryTeamMatch[]> {
  const re = new RegExp(escapeRegExp(q), 'i')
  const clauses: Record<string, unknown>[] = [{ name: re }, { contactEmails: re }]

  if (/^[0-9a-f]{4,24}$/i.test(q)) {
    clauses.push({
      $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `^${q.toLowerCase()}` } },
    })
  }
  const docs = await teams()
    .find({ deletedAt: { $exists: false }, $or: clauses })
    .limit(limit)
    .toArray()

  return docs.map((doc) => ({
    id: doc._id.toString(),
    name: doc.name ?? '',
    avatarUrl: doc.avatarUrl ?? '',
    contactEmails: doc.contactEmails ?? [],
  }))
}

export async function getUserForAdmin(
  userId: string,
): Promise<{ user: NuphosUser; teams: NuphosTeam[] } | null> {
  if (!MongoObjectId.isValid(userId)) return null
  const doc = await users().findOne({
    _id: new MongoObjectId(userId),
    deletedAt: { $exists: false },
  })

  if (!doc) return null

  return { user: mapUser(doc), teams: await getMyTeams(userId) }
}

export type TeamMemberForAdmin = NuphosUser & { role: NuphosTeamRole; joinedAt: string }

export async function getTeamForAdmin(teamId: string): Promise<{
  team: NuphosTeam & { memberCount: number }
  members: TeamMemberForAdmin[]
} | null> {
  if (!MongoObjectId.isValid(teamId)) return null
  const doc = await teams().findOne({
    _id: new MongoObjectId(teamId),
    deletedAt: { $exists: false },
  })

  if (!doc) return null
  const activeMembers = doc.members.filter((member) => !member.deletedAt)
  const memberDocs = await users()
    .find({
      _id: { $in: activeMembers.map((member) => member.userId) },
      deletedAt: { $exists: false },
    })
    .toArray()
  const byId = new Map(memberDocs.map((u) => [u._id.toHexString(), u]))
  const members = activeMembers.flatMap((member) => {
    const userDoc = byId.get(member.userId.toHexString())

    return userDoc
      ? [{ ...mapUser(userDoc), role: member.role, joinedAt: member.joinedAt.toISOString() }]
      : []
  })

  return { team: { ...mapTeam(doc), memberCount: activeMembers.length }, members }
}

// Directory lists sort by conversation activity ("last active" desc, inactive
// entries by createdAt desc). The sort key is computed from another
// collection, so pagination uses an offset cursor rather than an _id cursor.
const DIRECTORY_LIST_SCAN_CAP = 5000

function parseOffsetCursor(cursor: string | undefined): number {
  const n = Number(cursor ?? 0)

  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export async function listUsersForAdmin(options?: {
  limit?: number
  cursor?: string
  q?: string
}): Promise<{
  users: (NuphosUser & { lastActiveAt: string | null })[]
  nextCursor: string | null
  hasMore: boolean
}> {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 50))
  const offset = parseOffsetCursor(options?.cursor)
  const clauses: Record<string, unknown>[] = [{ deletedAt: { $exists: false } }]
  const q = options?.q?.trim()

  if (q) {
    const re = new RegExp(escapeRegExp(q), 'i')
    const or: Record<string, unknown>[] = [{ email: re }, { name: re }, { username: re }]

    if (MongoObjectId.isValid(q)) or.push({ _id: new MongoObjectId(q) })
    clauses.push({ $or: or })
  }
  const [docs, lastActive] = await Promise.all([
    users().find({ $and: clauses }).limit(DIRECTORY_LIST_SCAN_CAP).toArray(),
    getLastActiveByUser(),
  ])
  const sorted = docs
    .map((doc) => ({ doc, last: lastActive.get(doc._id.toHexString()) ?? null }))
    .sort(byLastActiveThenCreated)
  const pageRows = sorted.slice(offset, offset + limit)
  const hasMore = sorted.length > offset + limit

  return {
    users: pageRows.map(({ doc, last }) => ({
      ...mapUser(doc),
      lastActiveAt: last ? last.toISOString() : null,
    })),
    nextCursor: hasMore ? String(offset + limit) : null,
    hasMore,
  }
}

export async function listTeamsForAdmin(options?: {
  limit?: number
  cursor?: string
  q?: string
}): Promise<{
  teams: (NuphosTeam & { memberCount: number; lastActiveAt: string | null })[]
  nextCursor: string | null
  hasMore: boolean
}> {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 50))
  const offset = parseOffsetCursor(options?.cursor)
  const clauses: Record<string, unknown>[] = [{ deletedAt: { $exists: false } }]
  const q = options?.q?.trim()

  if (q) {
    const re = new RegExp(escapeRegExp(q), 'i')
    const or: Record<string, unknown>[] = [{ name: re }, { contactEmails: re }]

    if (MongoObjectId.isValid(q)) or.push({ _id: new MongoObjectId(q) })
    clauses.push({ $or: or })
  }
  const [docs, lastActive] = await Promise.all([
    teams().find({ $and: clauses }).limit(DIRECTORY_LIST_SCAN_CAP).toArray(),
    getLastActiveByTeam(),
  ])
  const sorted = docs
    .map((doc) => ({ doc, last: lastActive.get(doc._id.toHexString()) ?? null }))
    .sort(byLastActiveThenCreated)
  const pageRows = sorted.slice(offset, offset + limit)
  const hasMore = sorted.length > offset + limit

  return {
    teams: pageRows.map(({ doc, last }) => ({
      ...mapTeam(doc),
      memberCount: doc.members.filter((member) => !member.deletedAt).length,
      lastActiveAt: last ? last.toISOString() : null,
    })),
    nextCursor: hasMore ? String(offset + limit) : null,
    hasMore,
  }
}

function byLastActiveThenCreated(
  a: { doc: { createdAt: Date }; last: Date | null },
  b: { doc: { createdAt: Date }; last: Date | null },
): number {
  if (a.last && b.last) return b.last.getTime() - a.last.getTime()
  if (a.last) return -1
  if (b.last) return 1

  return b.doc.createdAt.getTime() - a.doc.createdAt.getTime()
}

export type DeleteTeamForAdminResult = 'deleted' | 'team_not_found'

/** Admin override: soft-delete any team without the owner check. */
export async function deleteTeamForAdmin(teamId: string): Promise<DeleteTeamForAdminResult> {
  if (!MongoObjectId.isValid(teamId)) return 'team_not_found'
  const teamObjectId = new MongoObjectId(teamId)
  const team = await teams().findOne({
    _id: teamObjectId,
    deletedAt: { $exists: false },
  })

  if (!team) return 'team_not_found'
  const result = await teams().updateOne(
    { _id: teamObjectId, deletedAt: { $exists: false } },
    { $set: { deletedAt: new Date(), updatedAt: new Date() } },
  )

  return result.modifiedCount > 0 ? 'deleted' : 'team_not_found'
}
