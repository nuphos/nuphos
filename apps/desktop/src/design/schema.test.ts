import assert from 'node:assert/strict'
import { test } from 'node:test'

import { usualFrameSize } from './schema.ts'

import type { DesignFrame, DesignPage } from './schema.ts'

const frame = (id: string, width: number, height: number): DesignFrame => ({
  id,
  type: 'frame',
  title: id,
  x: 0,
  y: 0,
  width,
  height,
  html: '',
})
const page = (objects: DesignFrame[]): DesignPage => ({ id: 'p', name: 'P', objects, links: [] })

test('a screen added to a page takes the size most of its screens have', () => {
  assert.equal(
    usualFrameSize(page([frame('a', 390, 844), frame('b', 390, 844), frame('c', 1440, 900)])),
    'phone',
  )
})

test('an empty page, a missing one or custom sizes fall back to desktop', () => {
  assert.equal(usualFrameSize(page([])), 'desktop')
  assert.equal(usualFrameSize(undefined), 'desktop')
  assert.equal(usualFrameSize(page([frame('a', 500, 500)])), 'desktop')
})
