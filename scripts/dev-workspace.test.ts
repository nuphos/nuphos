import assert from 'node:assert/strict'
import { test } from 'node:test'

import { instanceKey } from './dev-workspace.ts'

test('the instance key is NUPHOS_DEV_INSTANCE, else the worktree name, safe for paths', () => {
  assert.equal(instanceKey(undefined, '/Users/me/wt/pr-151'), 'pr-151')
  assert.equal(instanceKey('', '/wt/pr151'), 'pr151')
  assert.equal(instanceKey('e2e a/b', '/wt/pr151'), 'e2e-a-b')
})
