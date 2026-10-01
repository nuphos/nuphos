import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findBrokenLinks, isInside, windowsPaths } from './bundle-check.mjs'

function bundle() {
  const root = mkdtempSync(join(tmpdir(), 'bundle-'))

  mkdirSync(join(root, 'pkg'), { recursive: true })
  writeFileSync(join(root, 'pkg', 'cli.js'), '')

  return root
}

test('links that resolve inside the bundle are fine', () => {
  const root = bundle()

  symlinkSync(join('..', 'pkg', 'cli.js'), join(root, 'pkg', 'inside'))

  assert.deepEqual(findBrokenLinks(root), [])
})

test('dangling links and links out of the bundle are reported', () => {
  const root = bundle()
  const outside = mkdtempSync(join(tmpdir(), 'outside-'))

  writeFileSync(join(outside, 'x.js'), '')
  symlinkSync(join(root, 'gone', 'cli.js'), join(root, 'dangling'))
  symlinkSync(join(outside, 'x.js'), join(root, 'escaping'))

  assert.deepEqual(findBrokenLinks(root).sort(), ['dangling', 'escaping'])
})

test('containment is component-wise and holds across Windows drives', () => {
  assert.equal(isInside('/b', '/b/..safe/x'), true)
  assert.equal(isInside('/b', '/b-other/x'), false)
  assert.equal(isInside('C:\\b', 'C:\\b\\pkg\\cli.js', windowsPaths), true)
  assert.equal(isInside('C:\\b', 'D:\\b\\pkg\\cli.js', windowsPaths), false)
  assert.equal(isInside('C:\\b', 'C:\\other', windowsPaths), false)
})
