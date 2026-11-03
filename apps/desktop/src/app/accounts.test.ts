import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accountName,
  addAccountRequest,
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

test('an account that can no longer be used asks to be signed in again', async () => {
  const notices: (string | undefined)[] = []
  const switched: string[] = []
  const deps = (outcome: 'switched' | 'signInAgain') => ({
    switchAccount: async (key: string) => {
      switched.push(key)

      return outcome
    },
    requestAddAccount: (r: { notice?: string }) => notices.push(r.notice),
  })

  assert.equal(await switchToAccount(bob, (name) => `again: ${name}`, deps('switched')), 'switched')
  assert.deepEqual(notices, [])
  await switchToAccount(bob, (name) => `again: ${name}`, deps('signInAgain'))
  assert.deepEqual(notices, ['again: bob'])
  assert.deepEqual(switched, [bob.key, bob.key])
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
