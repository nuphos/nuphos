import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeSecretText, decodedSecretByteLength } from './config-secret-model.ts'

test('only exposes Secret data as editable text when it is valid UTF-8', () => {
  const text = btoa('hello')
  const binary = btoa(String.fromCharCode(0xff, 0, 0x80, 0x41))

  assert.equal(decodeSecretText(text), 'hello')
  assert.equal(decodeSecretText(binary), null)
  assert.equal(decodedSecretByteLength(binary), 4)
})
