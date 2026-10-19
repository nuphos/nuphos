import assert from 'node:assert/strict'
import { test } from 'node:test'

import { forgetMacAccounts, signInSession } from './useMacSignIn.ts'

import type { SignInPrompt } from './useMacSignIn.ts'
import type { MacAccount } from '../views/MacSignIn.tsx'

const accountA: MacAccount = { username: 'a', password: 'pa', target: '' }
const accountB: MacAccount = { username: 'b', password: 'pb', target: '' }

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

function session() {
  const state: { prompt: SignInPrompt } = { prompt: null }
  const signIn = signInSession((next) => {
    state.prompt = next(state.prompt)
  })

  return { state, signIn }
}

test('asks for an account; a refusal shows on the next ask; connecting clears it', () => {
  const { state, signIn } = session()
  const rfb = connection()

  signIn.watch(rfb, 'mac-1:0')
  rfb.fire('credentialsrequired')
  assert.deepEqual(state.prompt, { failed: false, username: true })
  rfb.fire('securityfailure')
  rfb.fire('credentialsrequired')
  assert.deepEqual(state.prompt, { failed: true, username: true })
  rfb.fire('connect')
  assert.equal(state.prompt, null)
})

test('a VNC password alone hides the account name', () => {
  const { state, signIn } = session()
  const rfb = connection()

  signIn.watch(rfb, 'mac-2:0')
  rfb.fire('credentialsrequired', ['password'])
  assert.deepEqual(state.prompt, { failed: false, username: false })
})

test('a submitted account answers later connections to its own Mac only, until refused', () => {
  const { signIn } = session()
  const first = connection()

  signIn.watch(first, 'mac-3:0')
  first.fire('credentialsrequired')
  signIn.submit(accountA)
  assert.deepEqual(first.sent, [accountA])
  const again = connection()

  signIn.watch(again, 'mac-3:0')
  again.fire('credentialsrequired')
  assert.deepEqual(again.sent, [accountA])
  const other = session()
  const elsewhere = connection()

  other.signIn.watch(elsewhere, 'mac-4:0')
  elsewhere.fire('credentialsrequired')
  assert.deepEqual(elsewhere.sent, [])
  again.fire('securityfailure')
  const third = connection()

  signIn.watch(third, 'mac-3:0')
  third.fire('credentialsrequired')
  assert.deepEqual(third.sent, [])
})

test('a connection keeps the target it opened with: B’s account never reaches A', () => {
  const { signIn } = session()
  const b = connection()

  signIn.watch(b, 'mac-b:0')
  b.fire('credentialsrequired')
  signIn.submit(accountB)
  // A connection opened for Mac A, then asked for credentials: it is not sent B's.
  const a = connection()

  signIn.watch(a, 'mac-a:0')
  a.fire('credentialsrequired')
  assert.deepEqual(a.sent, [])
  // Submitting A's prompt keeps the account under A, not B.
  signIn.submit(accountA)
  assert.deepEqual(a.sent, [accountA])
  const nextB = connection()

  signIn.watch(nextB, 'mac-b:0')
  nextB.fire('credentialsrequired')
  assert.deepEqual(nextB.sent, [accountB])
})

test('after reset, the old connection moves nothing and a submit goes nowhere', () => {
  const { state, signIn } = session()
  const old = connection()

  signIn.watch(old, 'mac-5:0')
  old.fire('credentialsrequired')
  signIn.reset()
  assert.equal(state.prompt, null)
  old.fire('credentialsrequired')
  old.fire('securityfailure')
  assert.equal(state.prompt, null)
  signIn.submit(accountA)
  assert.deepEqual(old.sent, [])
})

test('without a known device nothing is kept', () => {
  const { signIn } = session()
  const first = connection()

  signIn.watch(first, undefined)
  first.fire('credentialsrequired')
  signIn.submit(accountA)
  const second = connection()

  signIn.watch(second, undefined)
  second.fire('credentialsrequired')
  assert.deepEqual(second.sent, [])
})

test('signing out forgets every kept account', () => {
  const { signIn } = session()
  const first = connection()

  signIn.watch(first, 'mac-6:0')
  first.fire('credentialsrequired')
  signIn.submit(accountA)
  forgetMacAccounts()
  const second = connection()

  signIn.watch(second, 'mac-6:0')
  second.fire('credentialsrequired')
  assert.deepEqual(second.sent, [])
})
