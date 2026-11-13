import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindingShareStatus } from './bindingShare.ts'

test('a list of only the owner is private, a wider one is shared', () => {
  assert.equal(bindingShareStatus(['u1'], 'u1'), 'private')
  assert.equal(bindingShareStatus(['u1', 'u2'], 'u1'), 'members')
  assert.equal(bindingShareStatus(['*'], 'u1'), 'team')
})

test('without an owner, a list of at most one member is private', () => {
  assert.equal(bindingShareStatus([], null), 'private')
  assert.equal(bindingShareStatus(['u1'], undefined), 'private')
  assert.equal(bindingShareStatus(['u1', 'u2'], null), 'members')
})
