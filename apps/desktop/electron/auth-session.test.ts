import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AccountChangedError, AuthSession } from './auth-session.ts'

test('another account aborts the work of the one before it', () => {
  const session = new AuthSession('https://api.example.test')

  session.set('tok-a', 'a')
  const a = session.context()

  session.set('tok-b', 'b')
  assert.equal(a.signal.aborted, true)
  assert.ok(a.signal.reason instanceof AccountChangedError)
  assert.equal(session.context().signal.aborted, false)
  assert.ok(session.context().epoch > a.epoch)
})

test('signing out aborts the signed-in work', () => {
  const session = new AuthSession()

  session.set('tok-a', 'a')
  const a = session.context()

  session.set(null, null)
  assert.equal(a.signal.aborted, true)
  assert.equal(session.userId(), null)
})

test('signing in from no session keeps the signal, so startup reads are not cut off', () => {
  const session = new AuthSession()
  const before = session.context()

  assert.equal(session.settled(), false)
  session.set('tok-a', 'a')
  assert.equal(before.signal.aborted, false)
  assert.equal(session.settled(), true)
  assert.equal(session.context().signal, before.signal)
})

test('a sign-out during the startup check ends what read the token from disk', () => {
  const session = new AuthSession()
  const before = session.context()

  session.set(null, null)
  assert.equal(before.signal.aborted, true)
  assert.equal(session.context().signal.aborted, false)
})

test('a new backend ends the session: its token is never used there', () => {
  const session = new AuthSession('https://api.example.test')
  const seen: { api: string; token: string | null }[] = []

  session.set('tok-a', 'a')
  const a = session.context()

  session.subscribe(({ api, token }) => seen.push({ api, token }))
  session.moveTo('https://api.example.test')
  assert.deepEqual(seen, [], 'the same backend changes nothing')
  session.moveTo('https://other.example.test')
  assert.deepEqual(seen, [{ api: 'https://other.example.test', token: null }])
  assert.equal(a.signal.aborted, true)
  assert.equal(session.userId(), null)
})

test('the same token and user again is not a change', () => {
  const session = new AuthSession()
  let changes = 0

  session.subscribe(() => {
    changes += 1
  })
  session.set('tok-a', 'a')
  const a = session.context()

  session.set('tok-a', 'a')
  assert.equal(changes, 1)
  assert.equal(session.context(), a)
  assert.equal(a.signal.aborted, false)
})

test('the launch backend applies only before the session is used, without failing after', (t) => {
  const session = new AuthSession()

  t.mock.method(console, 'warn', () => {})
  session.start('http://127.0.0.1:3718')
  assert.equal(session.context().api, 'http://127.0.0.1:3718')
  assert.equal(session.context().epoch, 0)
  session.set('tok-a', 'a')
  assert.doesNotThrow(() => session.start('https://api.nuphos.ai'))
  assert.equal(session.context().api, 'http://127.0.0.1:3718')
})
