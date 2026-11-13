import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindingShareStatus, canEditBindingAccess, connectAllowList } from './bindingShare.ts'

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

test('its owner can always edit the list, an admin only while it is shared', () => {
  assert.equal(canEditBindingAccess(['u1'], 'u1', 'u1', false), true)
  assert.equal(canEditBindingAccess([], 'u1', 'u1', false), true)
  assert.equal(canEditBindingAccess(['u1'], null, 'u1', false), true)
  assert.equal(canEditBindingAccess(['u1'], 'u1', 'admin', true), false)
  assert.equal(canEditBindingAccess(['u1', 'u2'], 'u1', 'admin', true), true)
  assert.equal(canEditBindingAccess(['u1', 'u2'], 'u1', 'u2', false), false)
  assert.equal(canEditBindingAccess([], null, 'admin', true), true)
  assert.equal(canEditBindingAccess([], null, 'u2', false), false)
})

test('a connection shared while adding it keeps its owner on the list', () => {
  assert.deepEqual(connectAllowList(['u2'], 'u1'), ['u1', 'u2'])
  assert.deepEqual(connectAllowList(['u1', 'u2'], 'u1'), ['u1', 'u2'])
  assert.deepEqual(connectAllowList([], 'u1'), ['u1'])
  assert.deepEqual(connectAllowList(['*', 'u2'], 'u1'), ['*'])
})
