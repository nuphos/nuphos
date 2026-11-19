import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { botFoldTitles } from './chat-sections.ts'
import { forgetGroupFolds, loadGroupState, storedFoldCollapsed, writeGroupFold } from './state.ts'

const values = new Map<string, string>()

Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  },
  window: new EventTarget(),
})

beforeEach(() => values.clear())

const TEAM = 'team-a'
const [TREE, DONE] = botFoldTitles('bot-1')
const collapsed = (title: string, defaultCollapsed?: boolean) =>
  storedFoldCollapsed(loadGroupState(TEAM), { title, defaultCollapsed })

test('a Bot tree and its done group start folded', () => {
  assert.equal(TREE, 'bots:agent-session:bot-1')
  assert.equal(DONE, 'bots:agent-session:bot-1:done')
  assert.equal(collapsed(TREE), true)
  assert.equal(collapsed(DONE, true), true)
  assert.equal(collapsed('agent-session:task'), false)
})

test('a Bot tree opened by hand stays open from storage alone, done group kept apart', () => {
  writeGroupFold(TEAM, TREE, 'open')
  // A fresh read is what a swipe back, a remount or a restart sees.
  assert.equal(collapsed(TREE), false)
  assert.equal(collapsed(DONE, true), true)
  writeGroupFold(TEAM, DONE, 'open')
  assert.equal(collapsed(DONE, true), false)
  writeGroupFold(TEAM, TREE, 'closed')
  assert.equal(collapsed(TREE), true)
  assert.equal(collapsed(DONE, true), false)
})

test('Bot folds are per team', () => {
  writeGroupFold(TEAM, TREE, 'open')
  assert.equal(storedFoldCollapsed(loadGroupState('team-b'), { title: TREE }), true)
})

test('archiving a Bot forgets only its own folds', () => {
  const [otherTree] = botFoldTitles('bot-2')

  writeGroupFold(TEAM, TREE, 'open')
  writeGroupFold(TEAM, DONE, 'open')
  writeGroupFold(TEAM, otherTree, 'open')
  writeGroupFold('team-b', TREE, 'open')
  forgetGroupFolds(TEAM, botFoldTitles('bot-1'))

  assert.deepEqual(loadGroupState(TEAM), { [otherTree]: 'open' })
  assert.deepEqual(loadGroupState('team-b'), { [TREE]: 'open' })
})
