import { createHash } from 'node:crypto'

import { Binary, ObjectId } from 'mongodb'

import { config } from '@/config'
import { upsertCachedTeam, upsertCachedUser } from '@/lib/agent/directory'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'

import { hostedAvatarOwner, hostedAvatarPath } from './avatar-url'
import { mapTeam, mapUser, teams, users } from './shared'

export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024
export const AVATAR_SIZE = 256
// A 2 MB file can still declare a huge canvas; refuse it before decoding.
const MAX_AVATAR_PIXELS = 8192 * 8192
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp'])

// A photo superseded this recently may still be about to be published by a
// concurrent request, so pruning leaves it stored. Only the current one is served.
const PRUNE_GRACE_MS = 10 * 60 * 1000

type UserAvatarDoc = {
  _id?: ObjectId
  userId: ObjectId
  hash: string
  bytes: Binary
  updatedAt: Date
}

/** One document per (user, image hash); unique index in models/indexes-core. */
export const userAvatars = () => db().collection<UserAvatarDoc>('user_avatars')

/** Decodes an uploaded PNG/JPEG/WebP and re-encodes it as a 256px WebP. */
export async function renderAvatar(input: Uint8Array): Promise<Uint8Array> {
  try {
    const { format } = await new Bun.Image(input, { maxPixels: MAX_AVATAR_PIXELS }).metadata()

    if (!ACCEPTED_FORMATS.has(format)) throw new Error(`unsupported format ${format}`)

    return await new Bun.Image(input, { maxPixels: MAX_AVATAR_PIXELS })
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .bytes()
  } catch {
    throw new AppError(415, 'invalid_avatar_image', 'Use a PNG, JPEG or WebP image')
  }
}

/**
 * Stores the photo for `ownerId` (a user, an agent token or a team) and returns the
 * URL that will serve it once the owner's document points at it.
 */
export async function storeAvatar(ownerId: string, input: Uint8Array): Promise<string> {
  if (input.byteLength === 0) throw new AppError(400, 'invalid_avatar_image', 'The image is empty')
  if (input.byteLength > MAX_AVATAR_UPLOAD_BYTES)
    throw new AppError(413, 'avatar_too_large', 'Use an image under 2 MB')
  const bytes = await renderAvatar(input)
  const hash = createHash('sha256').update(bytes).digest('hex')

  // Each image is its own document, stored before the URL that names it is
  // published, so a concurrent upload or removal can't delete it from under
  // that URL. The owner's document holds the one current pointer.
  await userAvatars().updateOne(
    { userId: new ObjectId(ownerId), hash },
    { $set: { bytes: new Binary(bytes), updatedAt: new Date() } },
    { upsert: true },
  )

  return `${config.auth.publicBaseUrl}${hostedAvatarPath(ownerId, hash)}`
}

export async function uploadAvatar(userId: string, input: Uint8Array) {
  // A deletion request already removed the photo; a new one would outlive it.
  if (await deletionPending(userId))
    throw new AppError(409, 'account_deletion_pending', 'This account is being deleted')
  const _id = new ObjectId(userId)
  const avatarURL = await storeAvatar(userId, input)
  const user = await setAvatarURL(_id, avatarURL)

  // A deletion request is recorded before its one-time purge, and this photo
  // was stored before this check. So either that purge ran after the photo
  // was stored and removed it, or this check sees the request and takes the
  // photo back down.
  if (await deletionPending(userId)) {
    await withdrawAvatar(_id, avatarURL)
    throw new AppError(409, 'account_deletion_pending', 'This account is being deleted')
  }
  await pruneAvatars(userId)

  return user
}

/** Unpublishes `avatarURL` if it is still current, then deletes every stored photo. */
async function withdrawAvatar(_id: ObjectId, avatarURL: string) {
  const user = await users().findOneAndUpdate(
    { _id, avatarURL },
    { $set: { avatarURL: '', updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (user) upsertCachedUser(mapUser(user))
  await deleteUserAvatars(_id.toHexString())
}

export async function removeAvatar(userId: string) {
  const user = await setAvatarURL(new ObjectId(userId), '')

  await pruneAvatars(userId)

  return user
}

/**
 * Sets a team's icon to an uploaded image, or removes it with `null`. The
 * route checks the caller may edit the team.
 */
export async function setTeamAvatar(teamId: string, input: Uint8Array | null) {
  const avatarUrl = input ? await storeAvatar(teamId, input) : ''
  const team = await teams().findOneAndUpdate(
    { _id: new ObjectId(teamId), deletedAt: { $exists: false } },
    { $set: { avatarUrl, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!team) throw new AppError(404, 'team_not_found', 'Team not found')
  await pruneAvatars(teamId)
  const result = mapTeam(team)

  upsertCachedTeam(result)

  return result
}

async function setAvatarURL(_id: ObjectId, avatarURL: string) {
  const user = await users().findOneAndUpdate(
    { _id, deletedAt: { $exists: false } },
    { $set: { avatarURL, profileEdited: true, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!user) throw new AppError(404, 'user_not_found', 'Your account no longer exists')
  const result = mapUser(user)

  upsertCachedUser(result)

  return result
}

async function deletionPending(userId: string): Promise<boolean> {
  const request = await db()
    .collection<{ _id: string; status: string }>('account_deletion_requests')
    .findOne({ _id: userId, status: { $ne: 'completed' } })

  return request !== null
}

/** The owner's current avatar URL: a user's photo, an agent token's, or a team's icon. */
async function currentAvatarURL(_id: ObjectId): Promise<unknown> {
  const user = await users().findOne(
    { _id, deletedAt: { $exists: false } },
    { projection: { avatarURL: 1 } },
  )

  if (user) return user.avatarURL
  const agent = await db()
    .collection<{ _id: ObjectId; avatarUrl?: string }>('cli_tokens')
    .findOne({ _id, kind: 'agent' }, { projection: { avatarUrl: 1 } })

  if (agent) return agent.avatarUrl
  const team = await teams().findOne(
    { _id, deletedAt: { $exists: false } },
    { projection: { avatarUrl: 1 } },
  )

  return team?.avatarUrl
}

/** The image hash in the owner's current avatar URL, if it is one this backend serves. */
async function currentAvatarHash(_id: ObjectId): Promise<string | null> {
  const owned = await currentAvatarURL(_id)
  const url = typeof owned === 'string' ? owned : ''

  return url && hostedAvatarOwner(url) === _id.toHexString()
    ? (url.split('/').pop() ?? '').slice(0, 64)
    : null
}

/**
 * Deletes the owner's stored photos except the current one. A photo stored
 * within the grace window stays: a request racing this one may be about to
 * publish it. It is not served meanwhile (see readAvatar), and the next prune
 * removes it.
 */
export async function pruneAvatars(userId: string) {
  const _id = new ObjectId(userId)
  const current = await currentAvatarHash(_id)

  await userAvatars().deleteMany({
    userId: _id,
    ...(current ? { hash: { $ne: current } } : {}),
    updatedAt: { $lt: new Date(Date.now() - PRUNE_GRACE_MS) },
  })
}

/** Account deletion: the photo is personal data and must not outlive the request. */
export async function deleteUserAvatars(userId: string) {
  await userAvatars().deleteMany({ userId: new ObjectId(userId) })
}

/** Returns the stored WebP only while `hash` is the user's current avatar. */
export async function readAvatar(
  userId: string,
  hash: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!ObjectId.isValid(userId) || !/^[0-9a-f]{64}$/.test(hash)) return null
  const _id = new ObjectId(userId)

  if ((await currentAvatarHash(_id)) !== hash) return null
  const doc = await userAvatars().findOne({ userId: _id, hash })

  return doc ? Uint8Array.from(doc.bytes.buffer) : null
}
