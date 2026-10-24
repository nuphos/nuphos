import assert from 'node:assert/strict'
import test from 'node:test'

import { toolbarDensity } from './toolbarDensity.ts'

test('the toolbar folds controls away as the dock narrows, down to a 200px pane', () => {
  assert.equal(toolbarDensity(0), 'full')
  assert.equal(toolbarDensity(1200), 'full')
  assert.equal(toolbarDensity(520), 'full')
  assert.equal(toolbarDensity(519), 'compact')
  assert.equal(toolbarDensity(300), 'compact')
  assert.equal(toolbarDensity(299), 'tiny')
  assert.equal(toolbarDensity(200), 'tiny')
})
