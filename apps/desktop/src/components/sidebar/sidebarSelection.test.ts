import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  modeItems,
  readModeSelection,
  rememberModeSelection,
  restoreModeItem,
} from './sidebarSelection.ts'

import type { Item, Section } from './types'

const item = (key: string, extra: Partial<Item> = {}): Item => ({
  key,
  label: key,
  enabled: true,
  ...extra,
})

test('Bots and Tasks remember separate selections for each team', (context) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const data = new Map<string, string>()

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  })
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })
  rememberModeSelection('alpha', 1, item('bot-b'))
  rememberModeSelection('alpha', 2, item('task-c'))
  rememberModeSelection('beta', 1, item('bot-other'))
  assert.equal(readModeSelection('alpha', 1), 'bot-b')
  assert.equal(readModeSelection('alpha', 2), 'task-c')
  assert.equal(readModeSelection('beta', 1), 'bot-other')
  assert.equal(readModeSelection('beta', 2), null)
  const bots = [item('bot-a'), item('bot-b')]

  assert.equal(restoreModeItem(bots, readModeSelection('alpha', 1))?.key, 'bot-b')
})
test('a deleted or archived remembered conversation falls back to the first available item', () => {
  assert.equal(restoreModeItem([item('new')], 'archived')?.key, 'new')
  assert.equal(restoreModeItem([], 'archived'), undefined)
})
test('first-time Tasks selection follows visible state order and excludes Bots or disabled rows', () => {
  const sections: Section[] = [
    { title: 'Channels', items: [item('bot')] },
    {
      title: 'Tasks',
      items: [
        item('old', { task: true, taskState: 'idle' }),
        item('run', { task: true, taskState: 'working' }),
        item('ready', { task: true, taskState: 'attention' }),
        item('bot-task', { task: true, bot: true }),
        item('disabled', { task: true, enabled: false }),
      ],
    },
  ]

  assert.deepEqual(
    modeItems(sections, 1).map((row) => row.key),
    ['bot'],
  )
  assert.deepEqual(
    modeItems(sections, 2).map((row) => row.key),
    ['ready', 'run', 'old'],
  )
  assert.equal(restoreModeItem(modeItems(sections, 2), null)?.key, 'ready')
  assert.equal(restoreModeItem(modeItems(sections, 2), 'old')?.key, 'old')
})
