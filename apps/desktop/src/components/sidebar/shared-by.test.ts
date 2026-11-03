import assert from 'node:assert/strict'
import test from 'node:test'

import { sharerName, UNRESOLVED_OWNER_NAME } from './shared-by.ts'

test('a shared agent is credited to its owner by name, else by email', () => {
  assert.equal(sharerName({ name: 'Ada Lovelace', email: 'ada@example.com' }), 'Ada Lovelace')
  assert.equal(sharerName({ name: ' ', email: 'ada@example.com' }), 'ada@example.com')
})

test('an owner with neither name nor email is credited to no one', () => {
  assert.equal(sharerName({ name: '', email: '' }), undefined)
  assert.equal(sharerName(undefined), undefined)
})

test('an owner the backend could not resolve is credited by email, else to no one', () => {
  assert.equal(sharerName({ name: UNRESOLVED_OWNER_NAME, email: '' }), undefined)
  assert.equal(
    sharerName({ name: UNRESOLVED_OWNER_NAME, email: 'ada@example.com' }),
    'ada@example.com',
  )
})
