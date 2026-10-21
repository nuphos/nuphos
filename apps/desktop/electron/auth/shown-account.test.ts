import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shownAccount } from './shown-account.ts'

const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`

test('switching or adding another account moves away from the one shown', () => {
  const moved = shownAccount(() => 'https://api.nuphos.ai', jwt('u1'))

  assert.equal(moved(jwt('u1')), false)
  assert.equal(moved(jwt('u2')), true)
})

test('the same user on another backend is another account', () => {
  let api = 'https://api.nuphos.ai'
  const moved = shownAccount(() => api, jwt('u1'))

  api = 'https://nuphos.example.com'
  assert.equal(moved(jwt('u1')), true)
})

test('signing out moves away; signing in from the sign-in screen does not', () => {
  const moved = shownAccount(() => 'https://api.nuphos.ai', jwt('u1'))

  assert.equal(moved(null), true)
  assert.equal(moved(jwt('u2')), false)
})
