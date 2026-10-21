import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accessFor, accessMode } from './boxAccessPresentation.ts'

test('accessMode reads everyone, named members, or admins only', () => {
  assert.equal(accessMode(undefined), 'admins')
  assert.equal(accessMode({ everyone: true, userIds: [] }), 'everyone')
  assert.equal(accessMode({ everyone: false, userIds: ['alice'] }), 'members')
  // A Box listing only its admin creator is admins only once the members are known.
  assert.equal(accessMode({ everyone: false, userIds: ['admin'] }, new Set(['alice'])), 'admins')
})

test('accessFor stores only what the mode means', () => {
  assert.deepEqual(accessFor('everyone', ['alice']), { everyone: true, userIds: [] })
  assert.deepEqual(accessFor('admins', ['alice']), { everyone: false, userIds: [] })
  assert.deepEqual(accessFor('members', new Set(['alice', 'bob'])), {
    everyone: false,
    userIds: ['alice', 'bob'],
  })
})
