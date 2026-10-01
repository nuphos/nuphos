import { MongoServerError, ObjectId } from 'mongodb'
import { z } from 'zod'

import { trustedAvatarURL } from './avatar-url'
import { users, mapUser } from './shared'

import { upsertCachedUser } from '@/lib/agent/directory'
import { AppError } from '@/lib/errors'

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    username: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, underscores or hyphens'),
    avatarURL: z.union([
      z.literal(''),
      z
        .string()
        .max(2048)
        .url()
        .refine(
          (value) => trustedAvatarURL(value) !== undefined,
          'Use a Google profile-image URL (lh3–lh6.googleusercontent.com)',
        ),
    ]),
  })
  .strict()

export async function updateProfile(userId: string, input: unknown) {
  const parsed = profileUpdateSchema.safeParse(input)

  if (!parsed.success)
    throw new AppError(400, 'invalid_profile', parsed.error.issues[0]?.message ?? 'Invalid profile')
  try {
    const user = await users().findOneAndUpdate(
      { _id: new ObjectId(userId), deletedAt: { $exists: false } },
      { $set: { ...parsed.data, profileEdited: true, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (!user) throw new AppError(404, 'user_not_found', 'Your account no longer exists')
    const result = mapUser(user)

    upsertCachedUser(result)

    return result
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000)
      throw new AppError(409, 'username_taken', 'This username is already in use')
    throw error
  }
}
