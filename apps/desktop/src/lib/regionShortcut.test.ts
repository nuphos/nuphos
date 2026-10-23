import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextRegion, regionShortcut } from './regionShortcut.ts'

const input = (
  code: string,
  mods: Partial<Record<'meta' | 'control' | 'alt' | 'shift', boolean>> = {},
) => ({
  code,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...mods,
})

test('F6 moves to the next region and ⇧F6 to the previous one', () => {
  assert.equal(regionShortcut(input('F6')), 'focus-next-region')
  assert.equal(regionShortcut(input('F6', { shift: true })), 'focus-previous-region')
  assert.equal(regionShortcut(input('F6', { meta: true })), null)
  assert.equal(regionShortcut(input('F6', { control: true })), null)
  assert.equal(regionShortcut(input('F5')), null)
})

test('regions wrap around, and from none forward starts at the first', () => {
  assert.equal(nextRegion(0, 3, 1), 1)
  assert.equal(nextRegion(2, 3, 1), 0)
  assert.equal(nextRegion(0, 3, -1), 2)
  assert.equal(nextRegion(-1, 3, 1), 0)
  assert.equal(nextRegion(-1, 3, -1), 2)
  assert.equal(nextRegion(-1, 0, 1), -1)
})
