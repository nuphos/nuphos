import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyMeFailure, decideAuthStatus, isValidUserInfo } from './auth-status.ts'

import type { UserInfo } from './auth-status.ts'

// Run with: pnpm test  (node --experimental-strip-types --test electron/*.test.ts; Node >= 22.6)
//
// Covers the pure session-status logic: a /auth/me failure that does not prove
// the credential dead must NOT clear the saved sign-in, while a 401 the backend
// itself calls `unauthorized` must.

const USER: UserInfo = {
  id: 'u1',
  name: 'Bruce',
  email: 'bruce@example.com',
  username: 'bruce',
}
const CACHED: UserInfo = { ...USER, name: 'Bruce (cached)' }

test('only a 401 the backend calls unauthorized is a dead credential', () => {
  assert.equal(classifyMeFailure(401, 'unauthorized'), 'invalid')
})

test('a 401 without the backend code is a refusal, not a dead credential', () => {
  // A proxy, a WAF or a backend mid-deploy answers 401 without our JSON body.
  for (const code of [undefined, '', 'invalid_credentials', 'access_denied']) {
    assert.equal(classifyMeFailure(401, code), 'refused', `401 with ${String(code)}`)
  }
})

test('a 403 is always a refusal, never a dead credential', () => {
  for (const code of [undefined, 'forbidden', 'cli_token_forbidden', 'unauthorized']) {
    assert.equal(classifyMeFailure(403, code), 'refused', `403 with ${String(code)}`)
  }
})

test('every other status is transient, whatever the body says', () => {
  for (const status of [400, 404, 408, 429, 500, 502, 503, 504]) {
    assert.equal(classifyMeFailure(status, 'unauthorized'), 'transient', `HTTP ${status}`)
  }
})

test('isValidUserInfo accepts a well-formed identity', () => {
  assert.equal(isValidUserInfo(USER), true)
  // Optional fields may be absent.
  assert.equal(isValidUserInfo({ id: 'x', name: 'n', email: 'e', username: 'u' }), true)
})

test('isValidUserInfo rejects malformed / empty identities', () => {
  assert.equal(isValidUserInfo(null), false)
  assert.equal(isValidUserInfo(undefined), false)
  assert.equal(isValidUserInfo('string'), false)
  assert.equal(isValidUserInfo([]), false)
  assert.equal(isValidUserInfo({}), false)
  assert.equal(isValidUserInfo({ id: '', name: 'n', email: 'e', username: 'u' }), false) // empty id
  assert.equal(isValidUserInfo({ id: 'x', name: 'n', email: 'e' }), false) // missing username
  assert.equal(isValidUserInfo({ id: 1, name: 'n', email: 'e', username: 'u' }), false) // non-string id
})

test('a good probe is logged in with the fresh user', () => {
  const r = decideAuthStatus({ ok: true, user: USER }, 'tok', CACHED)

  assert.deepEqual(r, { loggedIn: true, user: USER, token: 'tok' })
})

test('transient failure keeps the session using the cached user', () => {
  const r = decideAuthStatus({ ok: false, failure: 'transient' }, 'tok', CACHED)

  assert.deepEqual(r, { loggedIn: true, user: CACHED, token: 'tok' })
})

test('transient failure with no cached user falls back to logged out', () => {
  // First-ever launch: nothing cached, so we cannot render the app shell.
  const r = decideAuthStatus({ ok: false, failure: 'transient' }, 'tok', undefined)

  assert.deepEqual(r, { loggedIn: false })
})

test('a refusal signs out this launch even when a cached user exists', () => {
  const r = decideAuthStatus({ ok: false, failure: 'refused', status: 403 }, 'tok', CACHED)

  assert.deepEqual(r, { loggedIn: false })
})

test('a dead credential logs out even when a cached user exists', () => {
  const r = decideAuthStatus({ ok: false, failure: 'invalid', status: 401 }, 'tok', CACHED)

  assert.deepEqual(r, { loggedIn: false })
})

test('a dead credential with no cache logs out', () => {
  const r = decideAuthStatus({ ok: false, failure: 'invalid', status: 401 }, 'tok', undefined)

  assert.deepEqual(r, { loggedIn: false })
})
