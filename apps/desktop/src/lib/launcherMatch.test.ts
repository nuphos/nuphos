import assert from 'node:assert/strict'
import { test } from 'node:test'

import { launcherMatchRank } from './launcherMatch.ts'

test('a label prefix outranks a word prefix, which outranks a substring', () => {
  assert.equal(launcherMatchRank('Terminal', 't'), 0)
  assert.equal(launcherMatchRank('Runtime terminal', 't'), 1)
  assert.equal(launcherMatchRank('Plans', 'la'), 2)
})

test('matching ignores case and surrounding spaces', () => {
  assert.equal(launcherMatchRank('Local terminal', '  LOC '), 0)
})

test('a label without the query does not match', () => {
  assert.equal(launcherMatchRank('Files', 'x'), null)
})

test('an empty query matches everything', () => {
  assert.equal(launcherMatchRank('Files', ' '), 0)
})
