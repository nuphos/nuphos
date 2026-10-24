import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { MongoServerError, ObjectId } from 'mongodb'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'

type Doc = Record<string, unknown>

const EMAIL = 'disabled@example.com'
const GOOGLE_ID = 'google-disabled'
let users: Doc[] = []

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$exists' in expected) {
      return (doc[key] !== undefined) === (expected as { $exists: boolean }).$exists
    }

    return String(doc[key]) === String(expected)
  })
}

const collection = {
  findOne: (filter: Doc) => Promise.resolve(users.find((doc) => matches(doc, filter)) ?? null),
  insertOne: (doc: Doc) => {
    // The unique email index, as in production.
    if (users.some((existing) => existing.email === doc.email)) {
      return Promise.reject(new MongoServerError({ code: 11000, message: 'E11000 duplicate key' }))
    }
    users.push(doc)

    return Promise.resolve({ acknowledged: true })
  },
  updateOne: () => Promise.resolve({ matchedCount: 1, modifiedCount: 1 }),
}

useDb({ db: () => ({ collection: () => collection }) as never })

const { signInWithGoogleCode, signInWithVerifiedEmail } = await import('./auth')

const realFetch = globalThis.fetch
const google = { ...config.auth.google }

beforeEach(() => {
  users = [
    {
      _id: new ObjectId(),
      email: EMAIL,
      googleID: GOOGLE_ID,
      username: 'disabled',
      name: 'Disabled',
      deletedAt: new Date('2026-10-24T00:00:00.000Z'),
    },
  ]
  config.auth.google.clientId = 'client'
  config.auth.google.clientSecret = 'secret'
  globalThis.fetch = (async (input: string | URL) =>
    input.toString().includes('/token')
      ? Response.json({ access_token: 'access' })
      : Response.json({
          id: GOOGLE_ID,
          email: EMAIL,
          verified_email: true,
          name: 'Disabled',
        })) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  Object.assign(config.auth.google, google)
})

describe('signing in to a disabled (deleted) account', () => {
  test('with an email code is refused, and no new account is created', async () => {
    await expect(signInWithVerifiedEmail(EMAIL)).rejects.toMatchObject({
      status: 403,
      code: 'account_disabled',
    })
    expect(users).toHaveLength(1)
  })

  test('with Google is refused, and no new account is created', async () => {
    await expect(
      signInWithGoogleCode('code', 'http://127.0.0.1:8123/callback'),
    ).rejects.toMatchObject({ status: 403, code: 'account_disabled' })
    expect(users).toHaveLength(1)
  })

  test('with Google under another Google id but the same email is refused', async () => {
    users[0]!.googleID = 'some-other-google-id'

    await expect(
      signInWithGoogleCode('code', 'http://127.0.0.1:8123/callback'),
    ).rejects.toMatchObject({ status: 403, code: 'account_disabled' })
    expect(users).toHaveLength(1)
  })
})
