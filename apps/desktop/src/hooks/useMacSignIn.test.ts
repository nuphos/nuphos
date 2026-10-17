import assert from 'node:assert/strict'
import { test } from 'node:test'

import { watchSignIn } from './useMacSignIn.ts'

import type { SignInPrompt } from './useMacSignIn.ts'

/** A connection that only fires events; it has no way to receive credentials. */
function connection() {
  const target = new EventTarget()

  return {
    addEventListener: target.addEventListener.bind(target),
    fire: (type: string) => target.dispatchEvent(new Event(type)),
  }
}

test('asks once, says so when the Mac refused the account, and clears once connected', () => {
  let prompt: SignInPrompt = null
  const rfb = connection()

  watchSignIn(
    rfb,
    () => true,
    (next) => {
      prompt = next(prompt)
    },
  )
  rfb.fire('credentialsrequired')
  assert.deepEqual(prompt, { failed: false })
  rfb.fire('securityfailure')
  // The reconnect asks again and keeps saying the last account was refused.
  rfb.fire('credentialsrequired')
  assert.deepEqual(prompt, { failed: true })
  rfb.fire('connect')
  assert.equal(prompt, null)
})

test('a connection that is no longer current moves nothing', () => {
  let prompt: SignInPrompt = null
  let current = 'a'
  const a = connection()
  const b = connection()
  const ask = (next: (value: SignInPrompt) => SignInPrompt) => {
    prompt = next(prompt)
  }

  watchSignIn(a, () => current === 'a', ask)
  current = 'b'
  watchSignIn(b, () => current === 'b', ask)
  a.fire('credentialsrequired')
  a.fire('securityfailure')
  assert.equal(prompt, null)
  b.fire('credentialsrequired')
  assert.deepEqual(prompt, { failed: false })
  a.fire('connect')
  assert.deepEqual(prompt, { failed: false })
})
