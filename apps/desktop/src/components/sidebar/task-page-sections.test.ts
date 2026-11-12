import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nestItems } from './nest-items.ts'
import { withProjects } from './task-projects.ts'

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

test('added empty folders survive status grouping and retain their actions', () => {
  const onActivate = () => undefined
  const rows = withProjects([], ['/work/demo'], () => ({ onActivate }))
  const sections = taskPageSections(rows)

  assert.deepEqual(sections[0].items, rows)
  assert.equal(sections[0].items[0].onActivate, onActivate)
})

test('mixed project tasks remain under one folder and idle-only folders go below the divider', () => {
  const rows = withProjects(
    [
      { ...row('idle', 'idle'), projectPath: '/work/mixed' },
      { ...row('run', 'working'), projectPath: '/work/mixed' },
      { ...row('done', 'idle'), projectPath: '/work/idle' },
    ],
    [],
    () => ({}),
  )
  const sections = taskPageSections(rows)
  const tree = nestItems(sections[0].items, () => false)

  assert.deepEqual(
    tree.map(({ item, depth }) => [item.key, depth]),
    [
      ['project:/work/mixed', 0],
      ['idle', 1],
      ['run', 1],
    ],
  )
  assert.deepEqual(
    sections[1].items.map((item) => item.key),
    ['project:/work/idle', 'done'],
  )
  assert.equal(sections[1].separator, true)
})

test('a working child stays attached to its idle parent above the divider', () => {
  const parent = row('parent', 'idle')
  const child = { ...row('child', 'working'), parentKey: parent.key }

  assert.deepEqual(taskPageSections([parent, child]), [
    { title: 'Tasks', items: [parent, child], compact: true },
  ])
})
