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

test('the first sign-in on an account is never reported', async () => {
  expect(await isNewSignIn(USER, TAIPEI_DESKTOP)).toBe(false)
})

test('a sign-in from a known IP, or the same app in the same city, is familiar', async () => {
  sessions = [session({ ip: '203.0.113.9' })]
  expect(await isNewSignIn(USER, { ...TAIPEI_DESKTOP, client: 'nuphos-android/1.4.0' })).toBe(false)

  sessions = [
    session({ ip: '198.51.100.7', city: 'Taipei', country: 'TW', client: 'nuphos-desktop/1.0.0' }),
  ]
  expect(await isNewSignIn(USER, TAIPEI_DESKTOP)).toBe(false)
})

test('the same app elsewhere in the same country is still reported', async () => {
  sessions = [
    session({
      ip: '198.51.100.7',
      city: 'Kaohsiung',
      country: 'TW',
      client: 'nuphos-desktop/1.0.0',
    }),
  ]
  expect(await isNewSignIn(USER, TAIPEI_DESKTOP)).toBe(true)
})

test('a new IP with a new app or country is reported', async () => {
  sessions = [session({ ip: '198.51.100.7', country: 'US', client: 'nuphos-desktop/1.0.0' })]
  expect(await isNewSignIn(USER, TAIPEI_DESKTOP)).toBe(true)

  sessions = [session({ ip: '198.51.100.7', country: 'TW', client: 'nuphos-cli/0.5.0' })]
  expect(await isNewSignIn(USER, TAIPEI_DESKTOP)).toBe(true)
})

test('expired sessions and other users do not count as familiar', async () => {
  sessions = [
    session({ ip: '198.51.100.7' }),
    session({ ip: '203.0.113.9', expiresAt: new Date(Date.now() - 1) }),
    { userId: 'someone-else', ip: '203.0.113.9', expiresAt: later },
  ]
  expect(await isNewSignIn(USER, TAIPEI_DESKTOP)).toBe(true)
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
