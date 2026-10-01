import { expect, test } from 'bun:test'
import { MongoServerError, ObjectId } from 'mongodb'

import { profileUpdateSchema, updateProfile } from './profile'

import { useDb } from '@/lib/test/doubles/db'

const profile = {
  name: ' Alice ',
  username: 'alice',
  avatarURL: 'https://lh3.googleusercontent.com/avatar.png',
}

test('profile edits normalize display names without permitting identity reassignment', () => {
  expect(profileUpdateSchema.parse(profile).name).toBe('Alice')
  expect(profileUpdateSchema.safeParse({ ...profile, username: '_A' }).success).toBe(true)
  expect(profileUpdateSchema.safeParse({ ...profile, email: 'other@example.com' }).success).toBe(
    false,
  )
  expect(profileUpdateSchema.safeParse({ ...profile, id: 'someone-else' }).success).toBe(false)
  expect(profileUpdateSchema.safeParse({ ...profile, name: ' ' }).success).toBe(false)
  expect(profileUpdateSchema.safeParse({ ...profile, username: '../alice' }).success).toBe(false)
})

test('avatars allow removal and HTTPS images, not local files or active content', () => {
  expect(profileUpdateSchema.safeParse({ ...profile, avatarURL: '' }).success).toBe(true)
  for (const avatarURL of [
    'https://example.com/pixel',
    'https://lh3.googleusercontent.com.evil.example/pixel',
    'https://lh3.googleusercontent.com@evil.example/pixel',
    'https://lh3.googleusercontent.com:8443/pixel',
    'file:///etc/passwd',
    ['javascript', 'alert(1)'].join(':'),
    'http://example.com/a',
    'data:text/html,bad',
  ]) {
    expect(profileUpdateSchema.safeParse({ ...profile, avatarURL }).success).toBe(false)
  }
})

let update: { filter: unknown; values: unknown } | undefined
let duplicate = false
const id = new ObjectId()

useDb({
  db: () => ({
    collection: () => ({
      findOneAndUpdate: async (filter: unknown, values: unknown) => {
        update = { filter, values }
        if (duplicate) throw new MongoServerError({ code: 11000, message: 'duplicate' })

        return {
          _id: id,
          email: 'original@example.com',
          name: 'Alice',
          username: 'alice',
          avatarURL: '',
          language: 'en',
          createdAt: new Date(),
        }
      },
      updateOne: async () => ({}),
    }),
  }),
})

test('profile update scopes the write to the authenticated active account and preserves email', async () => {
  duplicate = false
  const result = await updateProfile(id.toHexString(), profile)

  expect(update?.filter).toEqual({ _id: id, deletedAt: { $exists: false } })
  expect(update?.values).toEqual({
    $set: {
      name: 'Alice',
      username: 'alice',
      avatarURL: profile.avatarURL,
      profileEdited: true,
      updatedAt: expect.any(Date),
    },
  })
  expect(result.email).toBe('original@example.com')
})

test('duplicate username returns a conflict', async () => {
  duplicate = true
  try {
    await expect(updateProfile(id.toHexString(), profile)).rejects.toMatchObject({
      status: 409,
      code: 'username_taken',
    })
  } finally {
    duplicate = false
  }
})
