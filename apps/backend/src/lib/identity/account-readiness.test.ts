import { randomBytes } from 'node:crypto'

import { beforeEach, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import {
  getDeletionRequest,
  requestAccountDeletion,
  updateDeletionRequest,
} from './account-deletion'
import { AI_CONSENT_VERSION, readAIConsent, saveAIConsent } from './ai-consent'
import { setPasswordWithEmailCode, signInWithPassword } from './password'
import { mapUser } from './shared'
import { signNuphosToken } from './token'

import type { NuphosUserDoc } from './shared'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useEmailOtp } from '@/lib/test/doubles/email-otp'
import { real as realIdentity, useIdentity } from '@/lib/test/doubles/identity'
import { requireAuth } from '@/middleware/auth/core'

type Doc = Record<string, any>
const testPassword = randomBytes(24).toString('base64url')
const wrongPassword = randomBytes(24).toString('base64url')
const USER = new ObjectId('000000000000000000000001')
const OTHER = new ObjectId('000000000000000000000002')
const collections = new Map<string, Doc[]>()
const docs = (name: string) => {
  if (!collections.has(name)) collections.set(name, [])

  return collections.get(name)!
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value instanceof ObjectId) return String(doc[key]) === String(value)
    if (value && typeof value === 'object') {
      if ('$exists' in value) return (doc[key] !== undefined) === value.$exists
      if ('$ne' in value) return doc[key] !== value.$ne
    }

    return doc[key] === value
  })
}
useDb({
  db: () => ({
    collection: (name: string) => ({
      findOne: async (filter: Doc) => docs(name).find((doc) => matches(doc, filter)) ?? null,
      findOneAndUpdate: async (filter: Doc, update: Doc) => {
        let doc = docs(name).find((doc) => matches(doc, filter))

        if (!doc) {
          const inserted: Doc = { ...filter, ...update.$setOnInsert }

          docs(name).push(inserted)
          doc = inserted
        }
        for (const [key, value] of Object.entries(update.$inc ?? {}))
          doc[key] = Number(doc[key] ?? 0) + Number(value)

        return doc
      },
      updateOne: async (filter: Doc, update: Doc, options?: Doc) => {
        let doc = docs(name).find((doc) => matches(doc, filter))

        if (!doc && options?.upsert) {
          const inserted: Doc = { ...filter, ...update.$setOnInsert }

          docs(name).push(inserted)
          doc = inserted
        }
        if (!doc) return { matchedCount: 0 }
        Object.assign(doc, update.$set)

        return { matchedCount: 1 }
      },
    }),
  }),
})
let otpValid = true

useEmailOtp({
  verifyEmailOtp: async (email: string, code: string) => {
    if (!otpValid || code !== '123456') throw new Error('Invalid OTP')
    otpValid = false
    const doc = docs('users').find((doc) => doc.email === email)!

    return { user: mapUser(doc as NuphosUserDoc), token: 'verified-session' }
  },
})

beforeEach(() => {
  collections.clear()
  otpValid = true
  docs('users').push({
    _id: USER,
    email: 'review@example.com',
    name: 'Review',
    username: 'review',
    avatarURL: '',
    language: 'en-US',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

test('consent defaults off, rejects stale notices, and is scoped to the authenticated account', async () => {
  expect((await readAIConsent(String(USER))).accepted).toBe(false)
  await expect(
    saveAIConsent(String(USER), { version: 'old', accepted: true }),
  ).rejects.toMatchObject({ code: 'invalid_consent' })
  await saveAIConsent(String(USER), {
    version: AI_CONSENT_VERSION,
    accepted: true,
    userId: String(OTHER),
  })
  expect((await readAIConsent(String(USER))).accepted).toBe(true)
  await saveAIConsent(String(USER), { version: AI_CONSENT_VERSION, accepted: false })
  expect((await readAIConsent(String(USER))).accepted).toBe(false)
})

test('deletion requires email proof and persists one deadline across retries', async () => {
  const user = mapUser(docs('users')[0] as NuphosUserDoc)

  await expect(
    requestAccountDeletion(user, { confirmation: 'DELETE', code: '000000' }),
  ).rejects.toThrow('Invalid OTP')
  expect((await getDeletionRequest(user.id)).request).toBeNull()
  const first = await requestAccountDeletion(user, {
    confirmation: 'DELETE',
    code: '123456',
    userId: String(OTHER),
  })
  const second = await requestAccountDeletion(user, { confirmation: 'DELETE', code: '123456' })

  expect(second).toEqual(first)
  expect(docs('account_deletion_requests')).toHaveLength(1)
  expect(docs('account_deletion_requests')[0]!._id).toBe(user.id)
  expect(first.request!.dueAt.getTime() - first.request!.requestedAt.getTime()).toBe(30 * 86400000)
  expect(docs('users')).toHaveLength(1)
})

test('admin cannot falsely complete a deletion while a soft-deleted identity remains', async () => {
  docs('account_deletion_requests').push({
    _id: String(USER),
    status: 'requested',
    email: 'review@example.com',
  })
  docs('users')[0]!.deletedAt = new Date()
  await expect(
    updateDeletionRequest(String(USER), String(OTHER), {
      status: 'completed',
      evidence: 'All provider receipts verified.',
    }),
  ).rejects.toMatchObject({ code: 'account_not_erased' })
  collections.set('users', [])
  await updateDeletionRequest(String(USER), String(OTHER), {
    status: 'completed',
    evidence: 'All provider receipts verified.',
  })
  expect(docs('account_deletion_requests')[0]!.email).toBe('')
})

test('password setup needs email verification and never stores or returns plaintext', async () => {
  const input = { email: 'review@example.com', password: testPassword, code: '000000' }

  await expect(setPasswordWithEmailCode(input)).rejects.toThrow('Invalid OTP')
  expect(docs('users')[0]!.passwordHash).toBeUndefined()
  await setPasswordWithEmailCode({ ...input, code: '123456' })
  expect(docs('users')[0]!.passwordHash).toStartWith('$argon2id$')
  const result = await signInWithPassword(input)

  expect(result.user.id).toBe(String(USER))
  expect(JSON.stringify(result)).not.toContain('passwordHash')
  await expect(signInWithPassword({ ...input, password: wrongPassword })).rejects.toMatchObject({
    code: 'invalid_credentials',
  })
  await expect(
    signInWithPassword({ ...input, email: 'unknown@example.com' }),
  ).rejects.toMatchObject({ code: 'invalid_credentials' })
})

test('password attempts are bounded and deleted identities cannot authenticate', async () => {
  await setPasswordWithEmailCode({
    email: 'review@example.com',
    password: testPassword,
    code: '123456',
  })
  docs('users')[0]!.deletedAt = new Date()
  await expect(
    signInWithPassword({ email: 'review@example.com', password: testPassword }),
  ).rejects.toMatchObject({ code: 'invalid_credentials' })
  const counter = docs('password_login_attempts')[0]!

  counter.count = 10
  await expect(
    signInWithPassword({ email: 'review@example.com', password: testPassword }),
  ).rejects.toMatchObject({ code: 'login_rate_limited' })
})

useIdentity({
  authenticateToken: async (token: string) =>
    token === 'valid-session'
      ? { user: mapUser(docs('users')[0] as NuphosUserDoc), provider: 'nuphos', cacheHit: false }
      : null,
})

test('iOS AI requests require current saved consent, including after withdrawal', async () => {
  const app = new Hono().onError(errorHandler)

  app.use('*', requireAuth)
  app.post('/agent/chat', (c) => c.json({ ran: true }))
  app.get('/auth/me', (c) => c.json({ account: true }))
  app.put('/push/devices', (c) => c.json({ registered: true }))
  app.post('/agent/conversations/test/cancel-runtime', (c) => c.json({ cancelled: true }))
  const headers = {
    Authorization: 'Bearer valid-session',
    'x-nuphos-ai-consent-version': AI_CONSENT_VERSION,
  }

  expect((await app.request('/agent/chat', { method: 'POST', headers })).status).toBe(403)
  expect((await app.request('/auth/me', { headers })).status).toBe(200)
  expect((await app.request('/push/devices', { method: 'PUT', headers })).status).toBe(200)
  expect(
    (await app.request('/agent/conversations/test/cancel-runtime', { method: 'POST', headers }))
      .status,
  ).toBe(200)
  await saveAIConsent(String(USER), { version: AI_CONSENT_VERSION, accepted: true })
  expect((await app.request('/agent/chat', { method: 'POST', headers })).status).toBe(200)
  await saveAIConsent(String(USER), { version: AI_CONSENT_VERSION, accepted: false })
  expect((await app.request('/agent/chat', { method: 'POST', headers })).status).toBe(403)
  expect(
    (
      await app.request('/agent/chat', {
        method: 'POST',
        headers: { ...headers, Authorization: 'Bearer wrong' },
      })
    ).status,
  ).toBe(401)
})

test('password reset revokes previous sessions and issues a usable new session', async () => {
  const earlier = Date.now() - 60_000
  const clock = spyOn(Date, 'now').mockReturnValue(earlier)
  const oldToken = signNuphosToken(USER)

  clock.mockRestore()
  const result = await setPasswordWithEmailCode({
    email: 'review@example.com',
    password: testPassword,
    code: '123456',
  })

  expect(await realIdentity.authenticateToken(oldToken)).toBeNull()
  expect((await realIdentity.authenticateToken(result.token))?.user.id).toBe(String(USER))
})

test('deletion can use the account password without access to the email inbox', async () => {
  await setPasswordWithEmailCode({
    email: 'review@example.com',
    password: testPassword,
    code: '123456',
  })
  const user = mapUser(docs('users')[0] as NuphosUserDoc)

  await expect(
    requestAccountDeletion(user, { confirmation: 'DELETE', password: wrongPassword }),
  ).rejects.toMatchObject({ code: 'invalid_credentials' })
  expect((await getDeletionRequest(user.id)).request).toBeNull()
  const result = await requestAccountDeletion(user, {
    confirmation: 'DELETE',
    password: testPassword,
  })

  expect(result.request?.status).toBe('requested')
  expect(otpValid).toBe(false)
})
