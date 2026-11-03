import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accountName,
  addAccountRequest,
  keyBlockedByTakeover,
  backendLabel,
  cancelAddAccount,
  requestAddAccount,
  subscribeAddAccount,
  switchToAccount,
  waitingAccounts,
} from './accounts.ts'

import type { AccountSummary } from '../types'

const alice: AccountSummary = {
  key: 'alice@https://api.nuphos.ai',
  api: 'https://api.nuphos.ai',
  userInfo: { id: 'alice', name: 'Alice', email: 'a@example.com', username: 'alice' },
  active: true,
}
const bob: AccountSummary = {
  key: 'bob@https://nuphos.example.com',
  api: 'https://nuphos.example.com',
  active: false,
}

test('an account is named by its user, else by its id', () => {
  assert.equal(accountName(alice), 'Alice')
  assert.equal(accountName(bob), 'bob')
})

test('only a backend other than Nuphos Cloud is named', () => {
  assert.equal(backendLabel('https://api.nuphos.ai'), null)
  assert.equal(backendLabel('https://nuphos.example.com'), 'nuphos.example.com')
  assert.equal(backendLabel('http://127.0.0.1:3718'), '127.0.0.1:3718')
})

test('the waiting accounts are every one but the active', () => {
  assert.deepEqual(waitingAccounts([alice, bob]), [bob])
})

function switchDeps(outcome: 'switched' | 'signInAgain', current = 'https://api.nuphos.ai') {
  const events: string[] = []

  return {
    events,
    deps: {
      switchAccount: async (key: string) => {
        events.push(`switch ${key}`)

        return outcome
      },
      requestAddAccount: (r: { notice?: string }) => events.push(`sign in: ${r.notice ?? ''}`),
      currentApi: async () => current,
      moveTo: async (api: string) => events.push(`move ${api}`),
      reload: () => events.push('reload'),
    },
  }
}

test('a switch that worked asks for nothing more', async () => {
  const { events, deps } = switchDeps('switched')

  assert.equal(await switchToAccount(bob, (n) => `again: ${n}`, deps), 'switched')
  assert.deepEqual(events, [`switch ${bob.key}`])
})

test('an account that can no longer be used is asked for again on this backend', async () => {
  const { events, deps } = switchDeps('signInAgain', 'https://nuphos.example.com/')

  assert.equal(await switchToAccount(bob, (n) => `again: ${n}`, deps), 'signInAgain')
  assert.deepEqual(events, [`switch ${bob.key}`, 'sign in: again: bob'])
})

test('one on another backend moves the app there before asking for it', async () => {
  const { events, deps } = switchDeps('signInAgain', 'https://api.nuphos.ai')

  await switchToAccount(bob, (n) => `again: ${n}`, deps)
  assert.deepEqual(events, [`switch ${bob.key}`, 'move https://nuphos.example.com', 'reload'])
})

test('an add-account request is held until it is cancelled, and announced', () => {
  let changes = 0
  const stop = subscribeAddAccount(() => {
    changes += 1
  })

  requestAddAccount({ notice: 'again' })
  assert.deepEqual(addAccountRequest(), { notice: 'again' })
  cancelAddAccount()
  assert.equal(addAccountRequest(), null)
  stop()
  requestAddAccount()
  assert.equal(changes, 2)
  cancelAddAccount()
})

test('one backend spelt with another loopback name is not another backend', async () => {
  const local = { ...bob, api: 'http://127.0.0.1:3718' }
  const { events, deps } = switchDeps('signInAgain', 'http://localhost:3718/')

  await switchToAccount(local, (n) => `again: ${n}`, deps)
  assert.deepEqual(events, [`switch ${bob.key}`, 'sign in: again: bob'])
})

test('over the sign-in screen, shortcuts and keys aimed elsewhere never reach the workspace', () => {
  const inside = { closest: () => ({}) }
  const outside = { closest: () => null }
  const key = (target: unknown, mods: Partial<KeyboardEvent> = {}) =>
    ({ target, metaKey: false, ctrlKey: false, ...mods }) as unknown as KeyboardEvent

  assert.equal(keyBlockedByTakeover(key(outside, { metaKey: true }), false), false)
  assert.equal(keyBlockedByTakeover(key(inside), true), false, 'typing in its own fields')
  assert.equal(keyBlockedByTakeover(key(inside, { metaKey: true }), true), true, 'Cmd+Z, Cmd+\\')
  assert.equal(keyBlockedByTakeover(key(inside, { ctrlKey: true }), true), true)
  assert.equal(keyBlockedByTakeover(key(outside), true), true)
})
