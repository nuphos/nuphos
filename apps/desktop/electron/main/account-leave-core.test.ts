import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AuthSession } from '../auth-session.ts'

import { followAccount } from './account-leave-core.ts'

const CLOUD = 'https://api.nuphos.ai'
const SELF = 'https://nuphos.example.com'

function harness() {
  const session = new AuthSession(CLOUD)
  const events: string[] = []

  followAccount(session, {
    teardown: () => events.push('teardown'),
    reload: () => events.push('reload'),
  })
  const settled = () => new Promise((resolve) => setImmediate(resolve))

  return { session, events, settled }
}

test('signing in from no account neither tears down nor reloads', async () => {
  const h = harness()

  h.session.set('tok-a', 'a')
  await h.settled()
  assert.deepEqual(h.events, [])
})

test('a refreshed token for the same account is not leaving it', async () => {
  const h = harness()

  h.session.set('tok-a', 'a')
  h.session.set('tok-a2', 'a')
  h.session.use('https://api.nuphos.ai/', 'tok-a3', 'a')
  await h.settled()
  assert.deepEqual(h.events, [])
})

test('switching to another user, or the same user on another backend, leaves the account', async () => {
  const h = harness()

  h.session.set('tok-a', 'a')
  h.session.set('tok-b', 'b')
  assert.deepEqual(h.events, ['teardown'], 'shells end before anything sees the next account')
  await h.settled()
  h.session.use(SELF, 'tok-b-self', 'b')
  await h.settled()
  assert.deepEqual(h.events, ['teardown', 'reload', 'teardown', 'reload'])
})

test('signing out leaves the account', async () => {
  const h = harness()

  h.session.set('tok-a', 'a')
  h.session.set(null, null)
  await h.settled()
  assert.deepEqual(h.events, ['teardown', 'reload'])
})
