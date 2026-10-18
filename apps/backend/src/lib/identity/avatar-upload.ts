import { createHash } from 'node:crypto'

import { Binary, ObjectId } from 'mongodb'

import { config } from '@/config'
import { upsertCachedUser } from '@/lib/agent/directory'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'

import { hostedAvatarPath } from './avatar-url'
import { users, mapUser } from './shared'

export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024
export const AVATAR_SIZE = 256
// A 2 MB file can still declare a huge canvas; refuse it before decoding.
const MAX_AVATAR_PIXELS = 8192 * 8192
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp'])

type UserAvatarDoc = { _id: ObjectId; hash: string; bytes: Binary; updatedAt: Date }

const userAvatars = () => db().collection<UserAvatarDoc>('user_avatars')

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

export async function uploadAvatar(userId: string, input: Uint8Array) {
  if (input.byteLength === 0) throw new AppError(400, 'invalid_avatar_image', 'The image is empty')
  if (input.byteLength > MAX_AVATAR_UPLOAD_BYTES)
    throw new AppError(413, 'avatar_too_large', 'Use an image under 2 MB')
  const bytes = await renderAvatar(input)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const _id = new ObjectId(userId)

  // Store the image first so the URL written below always resolves.
  await userAvatars().replaceOne(
    { _id },
    { hash, bytes: new Binary(bytes), updatedAt: new Date() },
    { upsert: true },
  )
  const avatarURL = `${config.auth.publicBaseUrl}${hostedAvatarPath(userId, hash)}`

  return setAvatarURL(_id, avatarURL)
}

export async function removeAvatar(userId: string) {
  const _id = new ObjectId(userId)
  const user = await setAvatarURL(_id, '')

  await userAvatars().deleteOne({ _id })

  return user
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

/** Returns the stored WebP only while `hash` is the user's current avatar. */
export async function readAvatar(
  userId: string,
  hash: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!ObjectId.isValid(userId) || !/^[0-9a-f]{64}$/.test(hash)) return null
  const doc = await userAvatars().findOne({ _id: new ObjectId(userId), hash })

  return doc ? Uint8Array.from(doc.bytes.buffer) : null
}
