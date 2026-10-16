import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renameOutcome } from './inlineRename.ts'

test('a new name is saved trimmed; the same name is no change', () => {
  assert.deepEqual(renameOutcome('  Review ', 'Main'), {
    save: true,
    label: 'Review',
    shown: 'Review',
  })
  assert.deepEqual(renameOutcome(' Main ', 'Main'), { save: false })
})

test('an empty name restores the default where there is one, else changes nothing', () => {
  assert.deepEqual(renameOutcome('  ', 'Review', 'Claude Code'), {
    save: true,
    label: '',
    shown: 'Claude Code',
  })
  assert.deepEqual(renameOutcome('', 'Claude Code', 'Claude Code'), { save: false })
  assert.deepEqual(renameOutcome('', 'Build Box'), { save: false })
})
