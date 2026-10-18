import assert from 'node:assert/strict'
import { test } from 'node:test'

import { forgetMacAccounts, keepAccount, watchSignIn } from './useMacSignIn.ts'

import type { SignInPrompt } from './useMacSignIn.ts'
import type { MacAccount } from '../views/MacSignIn.tsx'

const account: MacAccount = { username: 'me', password: 'pw', target: '' }

/** A connection that fires noVNC's events and records what it was sent. */
function connection() {
  const target = new EventTarget()
  const sent: MacAccount[] = []

  return {
    sent,
    addEventListener: target.addEventListener.bind(target) as never,
    sendCredentials: (credentials: MacAccount) => sent.push(credentials),
    fire: (type: string, types = ['username', 'password']) =>
      target.dispatchEvent(Object.assign(new Event(type), { detail: { types } })),
  }
}

function watcher(rfb: ReturnType<typeof connection>, key: string, current = () => true) {
  const state: { prompt: SignInPrompt } = { prompt: null }

  watchSignIn(rfb, {
    current,
    target: () => key,
    ask: (next) => {
      state.prompt = next(state.prompt)
    },
  })

  return state
}

test('asks for an account; a refusal shows on the next ask; connecting clears it', () => {
  const rfb = connection()
  const state = watcher(rfb, 'mac-1:0')

  rfb.fire('credentialsrequired')
  assert.deepEqual(state.prompt, { failed: false, username: true })
  rfb.fire('securityfailure')
  rfb.fire('credentialsrequired')
  assert.deepEqual(state.prompt, { failed: true, username: true })
  rfb.fire('connect')
  assert.equal(state.prompt, null)
})

test('a VNC password alone hides the account name', () => {
  const rfb = connection()
  const state = watcher(rfb, 'mac-2:0')

  rfb.fire('credentialsrequired', ['password'])
  assert.deepEqual(state.prompt, { failed: false, username: false })
})

test('a superseded connection moves nothing and is sent nothing', () => {
  let current = 'a'
  const a = connection()
  const b = connection()
  const stateA = watcher(a, 'mac-3:0', () => current === 'a')

  current = 'b'
  watcher(b, 'mac-3:0', () => current === 'b')
  a.fire('credentialsrequired')
  a.fire('securityfailure')
  assert.equal(stateA.prompt, null)
  assert.deepEqual(a.sent, [])
})

test('a kept account answers its own Mac without asking, never another, until refused', () => {
  keepAccount('mac-4:0', account)
  const same = connection()
  const sameState = watcher(same, 'mac-4:0')
  const other = connection()
  const otherState = watcher(other, 'mac-5:0')

  same.fire('credentialsrequired')
  assert.deepEqual(same.sent, [account])
  assert.equal(sameState.prompt, null)
  other.fire('credentialsrequired')
  assert.deepEqual(other.sent, [])
  assert.deepEqual(otherState.prompt, { failed: false, username: true })
  // The Mac refuses it: forgotten, so the next connection asks.
  same.fire('securityfailure')
  const again = connection()

  watcher(again, 'mac-4:0')
  again.fire('credentialsrequired')
  assert.deepEqual(again.sent, [])
})

test('signing out forgets every kept account', () => {
  keepAccount('mac-6:0', account)
  forgetMacAccounts()
  const rfb = connection()
  const state = watcher(rfb, 'mac-6:0')

  rfb.fire('credentialsrequired')
  assert.deepEqual(rfb.sent, [])
  assert.deepEqual(state.prompt, { failed: false, username: true })
})
