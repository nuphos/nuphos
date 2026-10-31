import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boxWakes } from './boxWakes.ts'

test('a computer stays waking until every wake on it ends, and ending twice is harmless', () => {
  const signIn = boxWakes.begin('d1')
  const picker = boxWakes.begin('d1')

  signIn()
  assert.equal(boxWakes.isWaking('d1'), true)
  picker()
  picker()
  assert.equal(boxWakes.isWaking('d1'), false)
})

test('wakes on different computers do not affect each other', () => {
  const end = boxWakes.begin('d2')

  assert.equal(boxWakes.isWaking('d3'), false)
  end()
  assert.equal(boxWakes.isWaking('d2'), false)
})
