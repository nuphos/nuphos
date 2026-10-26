import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useEmail } from '@/lib/test/doubles/email'

import type * as dbActual from '@/lib/db'
import type { SendEmailInput } from '@/lib/email'

type Doc = Record<string, unknown>
let sessions: Doc[] = []
const sent: SendEmailInput[] = []

useDb({
  db: (() => ({
    collection: () => ({
      find: (filter: { userId: string }) => {
        const hits = sessions.filter(
          (s) => s.userId === filter.userId && (s.expiresAt as Date) > new Date(),
        )
        const cursor = { limit: () => cursor, toArray: async () => hits }

        return cursor
      },
    }),
  })) as unknown as typeof dbActual.db,
})
useEmail({
  isEmailConfigured: () => true,
  sendEmail: async (input: SendEmailInput) => {
    sent.push(input)
  },
})

const { isNewSignIn, sendNewSignInAlert } = await import('./sign-in-alert')

const USER = 'u1'
const later = new Date(Date.now() + 60_000)
const session = (fields: Doc) => ({ userId: USER, expiresAt: later, ...fields })
const TAIPEI_DESKTOP = {
  ip: '203.0.113.9',
  city: 'Taipei',
  country: 'TW',
  client: 'nuphos-desktop/1.0.0',
}

beforeEach(() => {
  sessions = []
  sent.length = 0
})

const account = (ageMs: number) =>
  ({
    id: USER,
    email: 'dev@example.com',
    createdAt: new Date(Date.now() - ageMs).toISOString(),
  }) as never
const OLD = account(90 * 24 * 60 * 60 * 1000)

test('a brand-new account’s first sign-in is not reported', async () => {
  expect(await isNewSignIn(account(5 * 60 * 1000), TAIPEI_DESKTOP)).toBe(false)
})

test('an older account with no session to compare with is reported', async () => {
  expect(await isNewSignIn(OLD, TAIPEI_DESKTOP)).toBe(true)
})

test('only the exact IP of an earlier session is familiar', async () => {
  sessions = [session({ ip: '203.0.113.9' })]
  expect(await isNewSignIn(OLD, { ...TAIPEI_DESKTOP, client: 'nuphos-android/1.4.0' })).toBe(false)

  // Same app, same city and country, another IP: still reported.
  sessions = [
    session({ ip: '203.0.113.10', city: 'Taipei', country: 'TW', client: 'nuphos-desktop/1.0.0' }),
  ]
  expect(await isNewSignIn(OLD, TAIPEI_DESKTOP)).toBe(true)
})

test('expired sessions and other users’ sessions are not familiar', async () => {
  sessions = [
    session({ ip: '203.0.113.9', expiresAt: new Date(Date.now() - 1) }),
    { userId: 'someone-else', ip: '203.0.113.9', expiresAt: later },
  ]
  expect(await isNewSignIn(OLD, TAIPEI_DESKTOP)).toBe(true)
})

test('the alert leads with time and IP, and names the device only from known values', async () => {
  const dev = { id: USER, email: 'dev@example.com', name: 'Dev', username: 'dev' } as never

  await sendNewSignInAlert(dev, TAIPEI_DESKTOP)
  expect(sent[0]!.to).toBe('dev@example.com')
  expect(sent[0]!.text).toContain('IP address: 203.0.113.9')
  expect(sent[0]!.text).toContain('Approximate location: Taipei, TW')
  expect(sent[0]!.text).toContain('Device: Nuphos Desktop 1.0.0')
  expect(sent[0]!.text).toContain('Signed-in devices')

  // Headers are caller-controlled: their text never reaches the email.
  const lure = 'Nuphos Security: reply with this code'

  await sendNewSignInAlert(dev, {
    ...TAIPEI_DESKTOP,
    client: lure,
    userAgent: `${lure} Mozilla/5.0 (Macintosh) Chrome/130`,
    city: '<b>x</b>',
  })
  expect(sent[1]!.text).not.toContain(lure)
  expect(sent[1]!.html).not.toContain(lure)
  expect(sent[1]!.text).toContain('Device: Chrome on macOS')
  expect(sent[1]!.html).not.toContain('<b>x</b>')
})
