import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'
import { generateOpaqueToken, hashToken } from '@/lib/oauth/tokens'

/**
 * Sign-in sessions. Each sign-in stores one row and hands the client an opaque
 * secret; only its SHA-256 is kept. Signing out deletes the row, so a session
 * ends on the server the moment it is revoked, not when a token expires.
 *
 * A session lapses after IDLE_MS without use and, regardless of use,
 * ABSOLUTE_MS after sign-in. `expiresAt` holds whichever comes first, so one
 * indexed comparison (and Mongo's TTL reaper) covers both.
 */
export const SESSION_TOKEN_PREFIX = 'nus_'

const DAY_MS = 24 * 60 * 60 * 1000
const IDLE_MS = 14 * DAY_MS
const ABSOLUTE_MS = 30 * DAY_MS
const TOUCH_RESOLUTION_MS = 60_000

export type UserSessionDoc = {
  _id: ObjectId
  secretHash: string
  userId: string
  createdAt: Date
  lastUsedAt: Date
  expiresAt: Date
  ip?: string
  /** Cloudflare's guess from the IP; absent off Cloudflare. */
  city?: string
  country?: string
  /** The app's own name and version (`x-atlas-client`), when it sends one. */
  client?: string
  userAgent?: string
}

/** Where a sign-in came from, kept so the user can recognise it later. */
export type SessionClient = Partial<
  Pick<UserSessionDoc, 'ip' | 'city' | 'country' | 'client' | 'userAgent'>
>

export const userSessions = () => db().collection<UserSessionDoc>('user_sessions')

export async function setupUserSessionIndexes(): Promise<void> {
  await Promise.all([
    userSessions().createIndex({ secretHash: 1 }, { unique: true, name: 'user_sessions_secret' }),
    userSessions().createIndex({ userId: 1, createdAt: -1 }, { name: 'user_sessions_user' }),
    userSessions().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'user_sessions_ttl' },
    ),
  ])
}

export function isSessionToken(token: string): boolean {
  return token.startsWith(SESSION_TOKEN_PREFIX)
}

export async function createUserSession(userId: string, client: SessionClient = {}) {
  const token = `${SESSION_TOKEN_PREFIX}${generateOpaqueToken()}`
  const now = new Date()

  await userSessions().insertOne({
    _id: new ObjectId(),
    secretHash: hashToken(token),
    userId,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + IDLE_MS),
    ...(client.ip ? { ip: client.ip } : {}),
    ...(client.city ? { city: client.city.slice(0, 128) } : {}),
    ...(client.country ? { country: client.country.slice(0, 8) } : {}),
    ...(client.client ? { client: client.client.slice(0, 128) } : {}),
    ...(client.userAgent ? { userAgent: client.userAgent.slice(0, 256) } : {}),
  })

  return token
}

/** The live session behind `token`, extending its idle window as a side effect. */
export async function findLiveSession(token: string): Promise<UserSessionDoc | null> {
  const now = new Date()
  const doc = await userSessions().findOne({
    secretHash: hashToken(token),
    expiresAt: { $gt: now },
  })

  if (!doc) return null
  if (now.getTime() - doc.lastUsedAt.getTime() >= TOUCH_RESOLUTION_MS) {
    const expiresAt = new Date(
      Math.min(doc.createdAt.getTime() + ABSOLUTE_MS, now.getTime() + IDLE_MS),
    )

    // Best effort: a missed write only shortens the idle window by a minute.
    void userSessions()
      .updateOne({ _id: doc._id }, { $set: { lastUsedAt: now, expiresAt } })
      .catch(() => {})
  }

  return doc
}

export async function listUserSessions(userId: string, currentId?: string) {
  const docs = await userSessions()
    .find({ userId, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .limit(200)
    .toArray()

  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    current: doc._id.toHexString() === currentId,
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    ip: doc.ip ?? null,
    city: doc.city ?? null,
    country: doc.country ?? null,
    client: doc.client ?? null,
    userAgent: doc.userAgent ?? null,
  }))
}

export async function revokeUserSession(userId: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false
  const { deletedCount } = await userSessions().deleteOne({ _id: new ObjectId(id), userId })

  return deletedCount === 1
}

/** Signs out every other device; returns how many sessions ended. */
export async function revokeOtherUserSessions(userId: string, keepId: string): Promise<number> {
  if (!ObjectId.isValid(keepId)) return 0
  const { deletedCount } = await userSessions().deleteMany({
    userId,
    _id: { $ne: new ObjectId(keepId) },
  })

  return deletedCount
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await userSessions().deleteMany({ userId })
}
