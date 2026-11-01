import { beforeEach, expect, test } from 'bun:test'

import { ObjectId } from 'mongodb'

import { parseFirstTouch, recordSignupSource } from '@/lib/identity/signup-source'
import { useDb } from '@/lib/test/doubles/db'
import { usePosthog } from '@/lib/test/doubles/posthog'

import type { NuphosUser } from '@/lib/identity/types'

let stored: Record<string, unknown> | undefined
let setOnce: { distinctId: string; properties: Record<string, unknown> }[] = []

useDb({
  db: () => ({
    collection: () => ({
      updateOne: async (_filter: unknown, update: { $set: { signupSource: unknown } }) => {
        if (stored) return { modifiedCount: 0 }
        stored = update.$set.signupSource as Record<string, unknown>

        return { modifiedCount: 1 }
      },
    }),
  }),
})
usePosthog({
  setPersonOnce: (distinctId, properties) => {
    setOnce.push({ distinctId, properties: properties as Record<string, unknown> })
  },
})
beforeEach(() => {
  stored = undefined
  setOnce = []
})

const user = (createdAt = new Date()): NuphosUser => ({
  id: new ObjectId().toHexString(),
  email: 'a@example.com',
  name: 'A',
  username: 'a',
  avatarURL: '',
  language: 'en-US',
  createdAt: createdAt.toISOString(),
})

const cookie = JSON.stringify({
  channel: 'hacker_news',
  source: 'hacker_news',
  medium: 'referral',
  referringDomain: 'news.ycombinator.com',
})

test('a new account stores its first touch once, on the user and the PostHog person', async () => {
  const u = user()

  await recordSignupSource(u, 'google', cookie)
  await recordSignupSource(u, 'google', JSON.stringify({ channel: 'x' }))

  expect(stored).toEqual({
    via: 'google',
    channel: 'hacker_news',
    source: 'hacker_news',
    medium: 'referral',
    referringDomain: 'news.ycombinator.com',
  })
  expect(setOnce).toHaveLength(1)
  expect(setOnce[0]?.distinctId).toBe(u.id)
  expect(setOnce[0]?.properties).toMatchObject({
    signup_via: 'google',
    signup_channel: 'hacker_news',
    signup_referring_domain: 'news.ycombinator.com',
  })
})

test('a signup without the cookie still records how it signed in', async () => {
  await recordSignupSource(user(), 'email', undefined)

  expect(stored).toEqual({ via: 'email' })
})

test('an older account signing in again is not a signup', async () => {
  await recordSignupSource(user(new Date(Date.now() - 2 * 60 * 60 * 1000)), 'google', cookie)

  expect(stored).toBeUndefined()
  expect(setOnce).toHaveLength(0)
})

test('the cookie is browser input: only short string fields survive', () => {
  expect(parseFirstTouch('not json')).toEqual({})
  expect(parseFirstTouch('"x"')).toEqual({})
  expect(
    parseFirstTouch(
      JSON.stringify({ channel: 'x', medium: 3, campaign: 'c'.repeat(201), extra: 'y' }),
    ),
  ).toEqual({ channel: 'x' })
})
