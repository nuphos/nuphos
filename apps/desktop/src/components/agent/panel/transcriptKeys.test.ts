import assert from 'node:assert/strict'
import { test } from 'node:test'

import { transcriptPageStep } from './transcriptKeys.ts'

const press = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...mods,
})

test('PageUp / PageDown page the transcript', () => {
  assert.equal(transcriptPageStep(press('PageDown')), 1)
  assert.equal(transcriptPageStep(press('PageUp')), -1)
})

test('modified, composing or already handled keys are left alone', () => {
  assert.equal(transcriptPageStep(press('PageDown', { shiftKey: true })), null)
  assert.equal(transcriptPageStep(press('PageUp', { metaKey: true })), null)
  assert.equal(transcriptPageStep(press('PageUp', { isComposing: true })), null)
  assert.equal(transcriptPageStep(press('PageUp', { defaultPrevented: true })), null)
  assert.equal(transcriptPageStep(press('ArrowDown')), null)
})
