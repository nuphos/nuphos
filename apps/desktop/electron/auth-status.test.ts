import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decideAuthStatus,
  isTokenRejected,
  isValidUserInfo,
  parseCallbackUser,
  unverifiedTokenSubject,
} from './auth-status.ts'

import type { UserInfo } from './auth-status.ts'

// Run with: pnpm test  (node --experimental-strip-types --test electron/*.test.ts; Node >= 22.6)
//
// Covers the pure session-status logic: a transient /auth/me
// failure (network down, 5xx) must NOT bounce a still-logged-in user to login,
// while a genuinely rejected token (401/403) must.

const USER: UserInfo = {
  id: 'u1',
  name: 'Bruce',
  email: 'bruce@example.com',
  username: 'bruce',
}
const CACHED: UserInfo = { ...USER, name: 'Bruce (cached)' }

test('only 401/403 count as a rejected token', () => {
  assert.equal(isTokenRejected(401), true)
  assert.equal(isTokenRejected(403), true)
  for (const code of [400, 404, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isTokenRejected(code), false, `HTTP ${code} should be transient`)
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
  const r = decideAuthStatus({ ok: false, transient: true }, 'tok', CACHED)

  assert.deepEqual(r, { loggedIn: true, user: CACHED, token: 'tok' })
})

test('transient failure with no cached user falls back to logged out', () => {
  // First-ever launch: nothing cached, so we cannot render the app shell.
  const r = decideAuthStatus({ ok: false, transient: true }, 'tok', undefined)

  assert.deepEqual(r, { loggedIn: false })
})

test('a rejected token logs out even when a cached user exists', () => {
  const r = decideAuthStatus({ ok: false, transient: false }, 'tok', CACHED)

  assert.deepEqual(r, { loggedIn: false })
})

test('a rejected token with no cache logs out', () => {
  const r = decideAuthStatus({ ok: false, transient: false }, 'tok', undefined)

  assert.deepEqual(r, { loggedIn: false })
})

// --- Identity forwarded on the login callback -------------------------------

const b64url = (value: string) => Buffer.from(value, 'utf8').toString('base64url')
const encodeUser = (user: unknown) => b64url(JSON.stringify(user))
const tokenFor = (sub: string) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ aud: 'nuphos', sub, scope: 'all' }),
  )}.signature-not-checked-here`

test('unverifiedTokenSubject reads sub from a session JWT', () => {
  assert.equal(
    unverifiedTokenSubject(tokenFor('507f1f77bcf86cd799439011')),
    '507f1f77bcf86cd799439011',
  )
})

test('unverifiedTokenSubject gives up on anything that is not a JWT', () => {
  assert.equal(unverifiedTokenSubject('opaque-token'), undefined)
  assert.equal(unverifiedTokenSubject('a.b'), undefined)
  assert.equal(unverifiedTokenSubject('a.!!!not-base64!!!.c'), undefined)
  assert.equal(unverifiedTokenSubject(`a.${b64url('not json')}.c`), undefined)
  assert.equal(
    unverifiedTokenSubject(`a.${b64url(JSON.stringify({ aud: 'nuphos' }))}.c`),
    undefined,
  )
  assert.equal(unverifiedTokenSubject(`a.${b64url(JSON.stringify({ sub: '' }))}.c`), undefined)
})

test('parseCallbackUser accepts an identity that matches the token subject', () => {
  const token = tokenFor('u1')

  assert.deepEqual(parseCallbackUser(encodeUser(USER), token), USER)
})

test('parseCallbackUser preserves non-ASCII names', () => {
  const token = tokenFor('u1')
  const user: UserInfo = { ...USER, name: '林小明' }

  assert.deepEqual(parseCallbackUser(encodeUser(user), token), user)
})

test('parseCallbackUser returns undefined when the landing page sends no user', () => {
  // An older landing page sends no user: the caller must fall back to
  // /auth/me rather than fail the sign-in.
  const token = tokenFor('u1')

  assert.equal(parseCallbackUser(null, token), undefined)
  assert.equal(parseCallbackUser(undefined, token), undefined)
  assert.equal(parseCallbackUser('', token), undefined)
})

test('parseCallbackUser rejects an identity bound to a different token', () => {
  assert.equal(parseCallbackUser(encodeUser(USER), tokenFor('someone-else')), undefined)
})

test('parseCallbackUser rejects malformed payloads', () => {
  const token = tokenFor('u1')

  assert.equal(parseCallbackUser('!!!not-base64!!!', token), undefined)
  assert.equal(parseCallbackUser(b64url('not json at all'), token), undefined)
  assert.equal(parseCallbackUser(encodeUser(null), token), undefined)
  assert.equal(parseCallbackUser(encodeUser({ id: 'u1' }), token), undefined) // missing fields
  assert.equal(parseCallbackUser(encodeUser({ ...USER, id: '' }), token), undefined)
})

test('parseCallbackUser still shape-checks when the token is not decodable', () => {
  // No subject to cross-check against, so the shape check is all we have.
  assert.deepEqual(parseCallbackUser(encodeUser(USER), 'opaque-token'), USER)
  assert.equal(parseCallbackUser(encodeUser({ id: 'u1' }), 'opaque-token'), undefined)
})
