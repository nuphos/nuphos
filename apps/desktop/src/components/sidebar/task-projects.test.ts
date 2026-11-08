import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nestItems } from './nest-items.ts'
import { withProjects } from './task-projects.ts'

import type { Item } from './types'

const task = (key: string, projectPath?: string, parentKey?: string): Item => ({
  key,
  label: key,
  enabled: true,
  ...(projectPath ? { projectPath } : {}),
  ...(parentKey ? { parentKey } : {}),
})
const shape = (items: Item[]) =>
  nestItems(items).map(({ item, depth }) => `${'  '.repeat(depth)}${item.label}`)

test('without a project, Tasks stay a flat list', () => {
  const tasks = [task('a'), task('b')]

  assert.equal(
    withProjects(tasks, [], () => ({})),
    tasks,
  )
})

test('tasks fold under their project, newest project first, and the rest under No project', () => {
  const items = withProjects(
    [
      task('fix', '/code/infra'),
      task('thread', '/code/infra', 'fix'),
      task('chat'),
      task('docs', '/code/site'),
    ],
    ['/code/empty', '/code/site'],
    () => ({}),
  )

  assert.deepEqual(shape(items), [
    'infra',
    '  fix',
    '    thread',
    'site',
    '  docs',
    'empty',
    'No project',
    '  chat',
  ])
})

test('an idle task stays listed under its project; an idle sub-agent is still counted', () => {
  const idle = (item: Item): Item => ({ ...item, finished: true })
  const items = withProjects(
    [idle(task('fix', '/code/infra')), idle(task('thread', '/code/infra', 'fix'))],
    [],
    () => ({}),
  )

  assert.deepEqual(
    nestItems(items).map(({ item, done }) => [item.label, done.map((row) => row.label)]),
    [
      ['infra', []],
      ['fix', ['thread']],
    ],
  )
})

test('a project row knows whether it holds any task', () => {
  const empty: Record<string, boolean> = {}

  withProjects([task('fix', '/code/infra')], ['/code/empty'], (key, _path, isEmpty) => {
    empty[key] = isEmpty

    return {}
  })
  assert.deepEqual(empty, { 'project:/code/infra': false, 'project:/code/empty': true })
})
