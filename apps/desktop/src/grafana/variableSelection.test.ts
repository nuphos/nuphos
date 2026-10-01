import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ALL_VALUE } from './model.ts'
import { reconcileVariableSelection } from './variableSelection.ts'

test('saved multi selections remain selected on dashboard load', () => {
  assert.equal(reconcileVariableSelection(['uid-a', 'uid-b'], ['uid-a', 'uid-b'], true), null)
})

test('a saved All selection remains All when Include All is enabled', () => {
  assert.equal(reconcileVariableSelection([ALL_VALUE], ['uid-a', 'uid-b'], true), null)
})

test('Include All does not make All the default when no current value was saved', () => {
  assert.deepEqual(reconcileVariableSelection([], ['uid-a', 'uid-b'], true), ['uid-a'])
})

test('stale selections are removed while valid saved selections survive', () => {
  assert.deepEqual(reconcileVariableSelection(['gone', 'uid-b'], ['uid-a', 'uid-b'], true), [
    'uid-b',
  ])
})
