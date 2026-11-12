import assert from 'node:assert/strict'
import { test } from 'node:test'

import { taskPageSections } from './task-page-sections.ts'

import type { Item } from './types'

const row = (key: string, taskState: Item['taskState']): Item => ({
  key,
  label: key,
  enabled: true,
  task: true,
  taskState,
})

test('empty tasks keep the page identity without status headings', () => {
  assert.deepEqual(taskPageSections([]), [{ title: 'Tasks', items: [], compact: true }])
})
test('attention and working share the active list; only idle goes below the divider', () => {
  const sections = taskPageSections([
    row('idle-a', 'idle'),
    row('ready', 'attention'),
    row('run', 'working'),
    row('idle-b', 'idle'),
  ])

  assert.deepEqual(
    sections[0].items.map((item) => item.key),
    ['ready', 'run'],
  )
  assert.deepEqual(
    sections[1].items.map((item) => item.key),
    ['idle-a', 'idle-b'],
  )
  assert.equal(sections[1].separator, true)
  assert.equal(sections[1].title, undefined)
})
test('without attention there is no empty divider and runtime icons remain intact', () => {
  const item = { ...row('with-model', 'idle'), iconNode: 'runtime-mark' }
  const sections = taskPageSections([item])

  assert.equal(sections[1].separator, false)
  assert.equal(sections[1].items[0].iconNode, 'runtime-mark')
})

test('working-only lists stay above the divider and pending responses precede unread results', () => {
  const working = row('run', 'working')

  assert.deepEqual(taskPageSections([working]), [
    { title: 'Tasks', items: [working], compact: true },
  ])
  const sections = taskPageSections([
    row('unread', 'attention'),
    { ...row('approval', 'attention'), dot: 'waiting' },
    working,
  ])

  assert.deepEqual(
    sections[0].items.map((item) => item.key),
    ['approval', 'unread', 'run'],
  )
  assert.equal(sections.length, 1)
})
