import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computersShortcut } from './computersShortcut.ts'

const input = {
  code: 'KeyE',
  meta: true,
  control: false,
  alt: false,
  shift: true,
  isComposing: false,
}

test('computer management uses Command Shift E on macOS and Control Shift E elsewhere', () => {
  assert.equal(computersShortcut(input, true), 'open-computers')
  assert.equal(computersShortcut({ ...input, meta: false, control: true }, false), 'open-computers')
})

test('computer management ignores extra modifiers, other keys and composition', () => {
  for (const change of [
    { shift: false },
    { alt: true },
    { control: true },
    { meta: false },
    { code: 'KeyR' },
    { isComposing: true },
  ])
    assert.equal(computersShortcut({ ...input, ...change }, true), null)
  assert.equal(computersShortcut(input, false), null)
})
