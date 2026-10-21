import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AGENT_SECTION_IDS,
  beforeIdAt,
  dropIndexAt,
  gripClickOpens,
  gripKeyStep,
  gripMenuAcceptsOpen,
  isNoopDrop,
  moveAnnouncement,
  moveSection,
  normalizeSectionOrder,
  parseSectionOrder,
  readSectionOrder,
  sectionOrderStorageKey,
  writeSectionOrder,
} from './sectionOrderPresentation.ts'

import type { OrderStorage } from './sectionOrderPresentation.ts'

const DEFAULTS = ['a', 'b', 'c'] as const

test('normalizeSectionOrder keeps a valid saved order', () => {
  assert.deepEqual(normalizeSectionOrder(['c', 'a', 'b'], DEFAULTS), ['c', 'a', 'b'])
})

test('normalizeSectionOrder falls back to the defaults for anything but an array', () => {
  assert.deepEqual(normalizeSectionOrder(null, DEFAULTS), ['a', 'b', 'c'])
  assert.deepEqual(normalizeSectionOrder({ a: 1 }, DEFAULTS), ['a', 'b', 'c'])
  assert.deepEqual(normalizeSectionOrder([], DEFAULTS), ['a', 'b', 'c'])
})

test('normalizeSectionOrder drops removed ids, duplicates and non-strings', () => {
  assert.deepEqual(normalizeSectionOrder(['c', 'gone', 3, 'c', 'b', 'a'], DEFAULTS), [
    'c',
    'b',
    'a',
  ])
})

test('normalizeSectionOrder slots a new section after its default predecessor', () => {
  assert.deepEqual(normalizeSectionOrder(['c', 'a'], DEFAULTS), ['c', 'a', 'b'])
  assert.deepEqual(normalizeSectionOrder(['b', 'c'], DEFAULTS), ['a', 'b', 'c'])
  assert.deepEqual(normalizeSectionOrder(['c', 'b'], DEFAULTS), ['a', 'c', 'b'])
})

test('parseSectionOrder tolerates missing and corrupt storage', () => {
  assert.deepEqual(parseSectionOrder(null, DEFAULTS), ['a', 'b', 'c'])
  assert.deepEqual(parseSectionOrder('{not json', DEFAULTS), ['a', 'b', 'c'])
  assert.deepEqual(parseSectionOrder('["b","a","c"]', DEFAULTS), ['b', 'a', 'c'])
})

test('moveSection moves before a section or to the end', () => {
  assert.deepEqual(moveSection(DEFAULTS, 'c', 'a'), ['c', 'a', 'b'])
  assert.deepEqual(moveSection(DEFAULTS, 'a', 'c'), ['b', 'a', 'c'])
  assert.deepEqual(moveSection(DEFAULTS, 'a', null), ['b', 'c', 'a'])
})

test('moveSection leaves the order alone for a self or unknown move', () => {
  assert.deepEqual(moveSection(DEFAULTS, 'b', 'b'), ['a', 'b', 'c'])
  assert.deepEqual(moveSection(DEFAULTS, 'x' as 'a', 'a'), ['a', 'b', 'c'])
})

test('moving among visible sections keeps hidden ones in place', () => {
  // 'b' is hidden; moving 'c' up one visible step lands it before 'a'.
  const visible = ['a', 'c'] as const

  assert.deepEqual(moveSection(DEFAULTS, 'c', beforeIdAt(visible, 0)), ['c', 'a', 'b'])
  assert.equal(beforeIdAt(visible, 2), null)
})

test('dropIndexAt picks the gap nearest the pointer', () => {
  const blocks = [
    { top: 0, height: 100 },
    { top: 120, height: 100 },
  ]

  assert.equal(dropIndexAt(10, blocks), 0)
  assert.equal(dropIndexAt(60, blocks), 1)
  assert.equal(dropIndexAt(200, blocks), 2)
  assert.equal(dropIndexAt(500, blocks), 2)
})

test('isNoopDrop flags the gaps either side of the dragged section', () => {
  assert.equal(isNoopDrop(1, 1), true)
  assert.equal(isNoopDrop(1, 2), true)
  assert.equal(isNoopDrop(1, 0), false)
  assert.equal(isNoopDrop(1, 3), false)
})

test('sectionOrderStorageKey separates people and teams', () => {
  assert.notEqual(sectionOrderStorageKey('u1', 't1'), sectionOrderStorageKey('u1', 't2'))
  assert.notEqual(sectionOrderStorageKey('u|1', 't'), sectionOrderStorageKey('u', '1|t'))
})

test('moveAnnouncement and the default section list', () => {
  assert.equal(moveAnnouncement('Agents', 1, 3), 'Agents moved to position 1 of 3')
  assert.deepEqual([...AGENT_SECTION_IDS], ['boxes', 'usage', 'agents'])
})

function memoryStorage(): OrderStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()

  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
}

test('each person and team key reads its own saved order', () => {
  const storage = memoryStorage()
  const mine = sectionOrderStorageKey('u1', 't1')
  const theirs = sectionOrderStorageKey('u2', 't1')

  writeSectionOrder(storage, mine, ['c', 'a', 'b'], DEFAULTS)
  assert.deepEqual(readSectionOrder(storage, mine, DEFAULTS), ['c', 'a', 'b'])
  assert.deepEqual(readSectionOrder(storage, theirs, DEFAULTS), ['a', 'b', 'c'])
})

test('saving the default order, as reset does, removes the key', () => {
  const storage = memoryStorage()

  writeSectionOrder(storage, 'k', ['b', 'a', 'c'], DEFAULTS)
  assert.equal(storage.data.get('k'), '["b","a","c"]')
  writeSectionOrder(storage, 'k', [...DEFAULTS], DEFAULTS)
  assert.equal(storage.data.has('k'), false)
})

test('a storage that throws costs only the saved order', () => {
  const broken: OrderStorage = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('full')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }

  assert.deepEqual(readSectionOrder(broken, 'k', DEFAULTS), ['a', 'b', 'c'])
  assert.doesNotThrow(() => writeSectionOrder(broken, 'k', ['c', 'b', 'a'], DEFAULTS))
  assert.deepEqual(readSectionOrder(null, 'k', DEFAULTS), ['a', 'b', 'c'])
})

test('the grip menu ignores mousedown and Alt+Arrow opens', () => {
  assert.equal(gripMenuAcceptsOpen({ type: 'mousedown' }), false)
  assert.equal(gripMenuAcceptsOpen({ type: 'keydown', altKey: true }), false)
  assert.equal(gripMenuAcceptsOpen({ type: 'keydown', altKey: false }), true)
  assert.equal(gripMenuAcceptsOpen({ type: 'click' }), true)
})

test('a pointer click opens the grip menu unless the press just closed it', () => {
  assert.equal(gripClickOpens(1, false), true)
  assert.equal(gripClickOpens(1, true), false)
  // Keyboard clicks report detail 0 and are opened by Base UI itself.
  assert.equal(gripClickOpens(0, false), false)
})

test('only Alt+Up and Alt+Down step a section', () => {
  assert.equal(gripKeyStep({ key: 'ArrowUp', altKey: true }), -1)
  assert.equal(gripKeyStep({ key: 'ArrowDown', altKey: true }), 1)
  assert.equal(gripKeyStep({ key: 'ArrowDown', altKey: false }), null)
  assert.equal(gripKeyStep({ key: 'Enter', altKey: true }), null)
})
