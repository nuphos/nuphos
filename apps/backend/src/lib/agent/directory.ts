import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { Collection } from 'mongodb'

type DirectoryUser = {
  id: string
  name?: string
  username?: string
  avatarURL?: string
}

type DirectoryTeam = {
  id: string
  name?: string
  avatarUrl?: string
}

export type CachedUser = {
  _id: string
  name: string
  username: string
  avatarURL: string
  updatedAt: Date
}

export type CachedTeam = {
  _id: string
  name: string
  avatarUrl: string
  updatedAt: Date
}

const USER_COLLECTION = 'agent_user_directory'
const TEAM_COLLECTION = 'agent_team_directory'

const userDirectory = (): Collection<CachedUser> => db().collection<CachedUser>(USER_COLLECTION)
const teamDirectory = (): Collection<CachedTeam> => db().collection<CachedTeam>(TEAM_COLLECTION)

// Cached entries expire after 30 days so renamed users / re-imaged teams
// refresh organically the next time the owner authenticates.
const DIRECTORY_TTL_SECONDS = 60 * 60 * 24 * 30

export async function setupDirectoryIndexes(): Promise<void> {
  await Promise.all([
    userDirectory()
      .createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: DIRECTORY_TTL_SECONDS, background: true },
      )
      .catch((err: unknown) => {
        logError('agent.directory.user_ttl_index_create_failed', err)
      }),
    teamDirectory()
      .createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: DIRECTORY_TTL_SECONDS, background: true },
      )
      .catch((err: unknown) => {
        logError('agent.directory.team_ttl_index_create_failed', err)
      }),
  ])
}

export function upsertCachedUser(user: DirectoryUser): void {
  if (!user.id) return
  userDirectory()
    .updateOne(
      { _id: user.id },
      {
        $set: {
          name: user.name ?? '',
          username: user.username ?? '',
          avatarURL: user.avatarURL ?? '',
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    )
    .catch((err: unknown) => {
      logError('agent.directory.user_upsert_failed', err, { user_id: user.id })
    })
}

export function upsertCachedTeam(team: DirectoryTeam): void {
  if (!team.id) return
  teamDirectory()
    .updateOne(
      { _id: team.id },
      {
        $set: {
          name: team.name ?? '',
          avatarUrl: team.avatarUrl ?? '',
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    )
    .catch((err: unknown) => {
      logError('agent.directory.team_upsert_failed', err, { team_id: team.id })
    })
}

export async function fetchCachedUsers(
  userIds: readonly string[],
): Promise<Record<string, { name: string; username: string; avatarURL: string }>> {
  const ids = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0)))

  if (!ids.length) return {}
  const docs = await userDirectory()
    .find({ _id: { $in: ids } }, { projection: { name: 1, username: 1, avatarURL: 1 } })
    .toArray()
  const out: Record<string, { name: string; username: string; avatarURL: string }> = {}

  for (const doc of docs) {
    out[doc._id] = {
      name: doc.name ?? '',
      username: doc.username ?? '',
      avatarURL: doc.avatarURL ?? '',
    }
  }

  return out
}

export async function fetchCachedTeams(
  teamIds: readonly string[],
): Promise<Record<string, { name: string; avatarUrl: string }>> {
  const ids = Array.from(new Set(teamIds.filter((id) => typeof id === 'string' && id.length > 0)))

  if (!ids.length) return {}
  const docs = await teamDirectory()
    .find({ _id: { $in: ids } }, { projection: { name: 1, avatarUrl: 1 } })
    .toArray()
  const out: Record<string, { name: string; avatarUrl: string }> = {}

  for (const doc of docs) {
    out[doc._id] = {
      name: doc.name ?? '',
      avatarUrl: doc.avatarUrl ?? '',
    }
  }

  return out
}
