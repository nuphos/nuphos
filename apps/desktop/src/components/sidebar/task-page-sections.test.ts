import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nestItems } from './nest-items.ts'
import { taskPageSections } from './task-page-sections.ts'

import type { Item } from './types'

const row = (key: string, lastActiveAt: string, extra: Partial<Item> = {}): Item => ({
  key,
  label: key,
  enabled: true,
  task: true,
  lastActiveAt,
  ...extra,
})

test('one chronological list keeps unread, working and read tasks together', () => {
  const old = row('old', '2026-11-12T01:00:00Z', { taskState: 'attention' })
  const recent = row('recent', '2026-11-12T03:00:00Z', { taskState: 'idle' })
  const working = row('working', '2026-11-12T02:00:00Z', { taskState: 'working' })

  assert.deepEqual(taskPageSections([old, recent, working]), [
    { title: 'Tasks', items: [old], compact: true },
    { items: [recent, working], compact: true, separator: true },
  ])
})
test('a pending child raises its whole tree; newest descendant determines chronological order', () => {
  const parent = row('parent', '2026-11-12T01:00:00Z')
  const child = row('child', '2026-11-12T04:00:00Z', { parentKey: 'parent' })
  const recent = row('recent', '2026-11-12T03:00:00Z')
  const waiting = row('waiting', '2026-11-12T00:00:00Z', { dot: 'waiting' })
  const sections = taskPageSections([recent, parent, child, waiting])

  assert.deepEqual(
    sections.flatMap((s) => s.items).map((x) => x.key),
    ['waiting', 'parent', 'child', 'recent'],
  )
  assert.deepEqual(
    nestItems(sections.flatMap((s) => s.items)).map((x) => x.depth),
    [0, 0, 1, 0],
  )
})
test('empty projects and missing timestamps remain stable and visible', () => {
  const folder = { ...row('folder', ''), project: true, task: false }
  const task = row('task', '')

  assert.deepEqual(
    taskPageSections([folder, task]).flatMap((s) => s.items),
    [folder, task],
  )
  assert.deepEqual(taskPageSections([]), [{ title: 'Tasks', items: [], compact: true }])
})

test('an unread child keeps the entire parent tree in the inbox', () => {
  const parent = row('parent', '2026-11-12T01:00:00Z', { taskState: 'idle' })
  const child = row('child', '2026-11-12T02:00:00Z', {
    parentKey: 'parent',
    taskState: 'attention',
  })

  assert.deepEqual(taskPageSections([parent, child]), [
    { title: 'Tasks', items: [parent, child], compact: true },
  ])
})

test('focusing an old read conversation does not move it into the inbox', () => {
  const old = row('old', '2026-11-12T01:00:00Z', { active: true })
  const sections = taskPageSections([old])

  assert.equal(sections[0].items.length, 0)
  assert.deepEqual(sections[1].items, [old])
})
