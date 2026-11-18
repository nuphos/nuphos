import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseDevOptions } from './dev-options.ts'

test('reset defaults off', () => {
  assert.deepEqual(parseDevOptions([]), { reset: false })
})

test('--reset wipes the stack first', () => {
  assert.deepEqual(parseDevOptions(['--reset']), { reset: true })
})
