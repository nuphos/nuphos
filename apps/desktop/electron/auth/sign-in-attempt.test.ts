import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertWanted, beginSignIn, cancelSignIns } from './sign-in-attempt.ts'

test('a cancelled or replaced sign-in is never saved', () => {
  const first = beginSignIn()

  assert.doesNotThrow(() => assertWanted(first))
  const second = beginSignIn()

  assert.throws(() => assertWanted(first), /cancelled/u)
  assert.doesNotThrow(() => assertWanted(second))
  cancelSignIns()
  assert.throws(() => assertWanted(second), /cancelled/u)
})
