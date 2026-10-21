import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AccountContexts, accountOf } from './account-context.ts'

import type { AccountContext } from './account-context.ts'

const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`
const CLOUD = 'https://api.nuphos.ai'
const SELF = 'https://nuphos.example.com'

test('a swap changes backend and token together, in one notification', () => {
  const applied: string[] = []
  const contexts = new AccountContexts(CLOUD, (api) => applied.push(api))
  const seen: [string, string | null, string][] = []

  contexts.swap({ api: CLOUD, token: jwt('u1') }, 'signIn')
  contexts.subscribe((next, _prev, reason) => seen.push([next.api, next.token, reason]))
  contexts.swap({ api: SELF, token: jwt('u2') }, 'switch')

  assert.deepEqual(seen, [[SELF, jwt('u2'), 'switch']])
  assert.deepEqual(applied, [CLOUD, SELF])
})

test('a token never moves to another backend', () => {
  const contexts = new AccountContexts(CLOUD)

  contexts.swap({ api: CLOUD, token: jwt('u1') }, 'signIn')
  assert.throws(() => contexts.swap({ api: SELF, token: jwt('u1') }, 'endpoint'))
  assert.equal(contexts.current().api, CLOUD)
})

test('a context taken before a change is no longer current', () => {
  const contexts = new AccountContexts(CLOUD)
  const before = contexts.swap({ api: CLOUD, token: jwt('u1') }, 'signIn')

  assert.equal(contexts.isCurrent(before), true)
  // Unchanged: no new epoch.
  assert.equal(contexts.swap({ api: CLOUD, token: jwt('u1') }, 'refresh'), before)
  contexts.swap({ api: CLOUD, token: jwt('u2') }, 'switch')
  assert.equal(contexts.isCurrent(before), false)
  assert.equal(contexts.current().epoch, before.epoch + 1)
})

test('leaving an account ends its work before listeners hear of the next one', () => {
  const contexts = new AccountContexts(CLOUD)
  const events: string[] = []

  contexts.onLeave(() => events.push('ended'))
  contexts.subscribe((next: AccountContext) => events.push(`now ${accountOf(next) ?? 'nobody'}`))
  // Signing in from the sign-in screen leaves no account.
  contexts.swap({ api: CLOUD, token: jwt('u1') }, 'signIn')
  // The same account with a new token stays.
  contexts.swap({ api: CLOUD, token: `${jwt('u1')}x` }, 'signIn')
  // The same user on another backend is another account.
  contexts.swap({ api: SELF, token: jwt('u1') }, 'switch')
  contexts.swap({ api: SELF, token: null }, 'signOut')

  assert.deepEqual(events, [
    `now u1@${CLOUD}`,
    `now u1@${CLOUD}`,
    'ended',
    `now u1@${SELF}`,
    'ended',
    'now nobody',
  ])
})
