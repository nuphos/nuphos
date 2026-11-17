import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accessFor, accessMode, accessSaveSteps } from './boxAccessPresentation.ts'

test('accessMode reads everyone, named members, or private', () => {
  assert.equal(accessMode(undefined), 'private')
  assert.equal(accessMode({ everyone: true, userIds: [] }), 'everyone')
  assert.equal(accessMode({ everyone: false, userIds: ['alice'] }), 'members')
  assert.equal(accessMode({ everyone: false, userIds: [] }), 'private')
})

test('accessFor stores only what the mode means', () => {
  assert.deepEqual(accessFor('everyone', ['alice']), { everyone: true, userIds: [] })
  assert.deepEqual(accessFor('private', ['alice']), { everyone: false, userIds: [] })
  assert.deepEqual(accessFor('members', new Set(['alice', 'bob'])), {
    everyone: false,
    userIds: ['alice', 'bob'],
  })
})

test('a save that fails halfway never leaves a Box more open than either state asked for', () => {
  assert.deepEqual(accessSaveSteps(undefined), ['access'])
  // Turning terminals off goes first: new members never get one if the second save fails.
  assert.deepEqual(accessSaveSteps(false), ['terminal', 'access'])
  // Turning them on goes last: people who lose access never keep one.
  assert.deepEqual(accessSaveSteps(true), ['access', 'terminal'])
})
