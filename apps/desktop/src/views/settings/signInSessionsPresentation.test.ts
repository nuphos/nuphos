import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sessionDevice, sessionPlace, sortSessions } from './signInSessionsPresentation.ts'

import type { SignInSession } from '../../types/team.ts'

test('an app that names itself is shown by name, without the version it claims', () => {
  assert.equal(
    sessionDevice({ client: 'nuphos-desktop/1.2.0', userAgent: 'node' }),
    'Nuphos Desktop',
  )
  assert.equal(
    sessionDevice({ client: 'nuphos-android/1.4.0', userAgent: null }),
    'Nuphos for Android',
  )
  assert.equal(
    sessionDevice({ client: 'nuphos-desktop/1.verify-at.evil-phish.com', userAgent: null }),
    'Nuphos Desktop',
  )
  // Not a property of a plain object either.
  assert.equal(sessionDevice({ client: 'constructor/1', userAgent: null }), 'Unknown device')
  assert.equal(sessionDevice({ client: '__proto__/1', userAgent: null }), 'Unknown device')
  // Anything else the client sent is never echoed.
  assert.equal(
    sessionDevice({ client: 'Nuphos Security: reply with this code', userAgent: null }),
    'Unknown device',
  )
})

test('without an app name, the user agent gives a rough guess', () => {
  assert.equal(sessionDevice({ client: null, userAgent: 'node' }), 'Web sign-in (nuphos.ai)')
  assert.equal(
    sessionDevice({
      client: null,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36',
    }),
    'Chrome on macOS',
  )
  assert.equal(sessionDevice({ client: null, userAgent: 'anything at all' }), 'Unknown device')
  assert.equal(sessionDevice({ client: null, userAgent: null }), 'Unknown device')
})

test('place joins city, country and IP, whatever is known', () => {
  assert.equal(
    sessionPlace({ city: 'Taipei', country: 'TW', ip: '203.0.113.9' }),
    'Taipei, TW · 203.0.113.9',
  )
  assert.equal(
    sessionPlace({ city: null, country: null, ip: '203.0.113.9' }),
    'Unknown location · 203.0.113.9',
  )
  assert.equal(sessionPlace({ city: null, country: null, ip: null }), 'Unknown location')
})

test('this device comes first, then the most recently active', () => {
  const s = (id: string, lastUsedAt: string, current = false) =>
    ({ id, lastUsedAt, current }) as SignInSession

  assert.deepEqual(
    sortSessions([
      s('old', '2026-10-01'),
      s('here', '2026-09-01', true),
      s('new', '2026-10-20'),
    ]).map((x) => x.id),
    ['here', 'new', 'old'],
  )
})
