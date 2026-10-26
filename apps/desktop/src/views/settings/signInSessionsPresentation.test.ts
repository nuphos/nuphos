import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sessionDevice, sessionPlace, sortSessions } from './signInSessionsPresentation.ts'

import type { SignInSession } from '../../types/team.ts'

test('an app that names itself is shown by name and version', () => {
  assert.equal(
    sessionDevice({ client: 'nuphos-desktop/1.2.0', userAgent: 'node' }),
    'Nuphos Desktop 1.2.0',
  )
  assert.equal(
    sessionDevice({ client: 'nuphos-android/1.4.0', userAgent: null }),
    'Nuphos for Android 1.4.0',
  )
  assert.equal(sessionDevice({ client: 'something-else/2', userAgent: null }), 'something-else/2')
})

test('without an app name, the user agent gives a rough guess', () => {
  assert.equal(sessionDevice({ client: null, userAgent: 'node' }), 'Web sign-in (nuphos.ai)')
  assert.equal(
    sessionDevice({ client: null, userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15' }),
    'Web browser',
  )
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
