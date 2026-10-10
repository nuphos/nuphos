import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSplitShortcut } from './splitLayout.ts'

const plain = { metaKey: false, ctrlKey: false, altKey: false, code: 'KeyD', isComposing: false }

test('macOS reserves Ctrl+D for terminal EOF and Cmd+D for splitting', () => {
  assert.equal(isSplitShortcut({ ...plain, ctrlKey: true }, true), false)
  assert.equal(isSplitShortcut({ ...plain, metaKey: true }, true), true)
  assert.equal(isSplitShortcut({ ...plain, ctrlKey: true, metaKey: true }, true), false)
})

test('non-Mac split modifier, unrelated keys, Alt and composition remain distinct', () => {
  assert.equal(isSplitShortcut({ ...plain, ctrlKey: true }, false), true)
  assert.equal(isSplitShortcut({ ...plain, metaKey: true }, false), false)
  assert.equal(isSplitShortcut({ ...plain, metaKey: true, code: 'KeyC' }, true), false)
  assert.equal(isSplitShortcut({ ...plain, metaKey: true, altKey: true }, true), false)
  assert.equal(isSplitShortcut({ ...plain, metaKey: true, isComposing: true }, true), false)
})
