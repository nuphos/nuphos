import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MIN_RUNTIME_PASSWORD, runtimePasswordProblem } from './runtimePassword.ts'

test('a password the runtime will accept raises nothing', () => {
  // `openssl rand -hex 32` is what the README tells an operator to run.
  assert.equal(runtimePasswordProblem('0123456789abcdef'.repeat(4)), undefined)
  assert.equal(runtimePasswordProblem("a!#$%&'*+-.^_`|~".repeat(2)), undefined)
})

test('a short password says how far short it is', () => {
  assert.equal(
    runtimePasswordProblem('a'.repeat(MIN_RUNTIME_PASSWORD - 1)),
    `${String(MIN_RUNTIME_PASSWORD - 1)} of at least ${String(MIN_RUNTIME_PASSWORD)} characters.`,
  )
})

test('a character that cannot ride a WebSocket header is named before submitting', () => {
  // Base64 padding and slashes are the usual offenders from a pasted secret.
  for (const bad of ['has space', 'base64/with=padding', 'quote"', 'colon:x']) {
    assert.match(runtimePasswordProblem(bad.padEnd(40, 'a')) ?? '', /^Only letters, digits/u)
  }
})

test('an empty field is not an error yet', () => {
  assert.equal(runtimePasswordProblem(''), undefined)
})
