import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { botFoldTitle } from './chat-sections.ts'
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
const TREE = botFoldTitle('bot-1')
const collapsed = (title: string) => storedFoldCollapsed(loadGroupState(TEAM), { title })

test('a Bot tree starts folded', () => {
  assert.equal(TREE, 'bots:agent-session:bot-1')
  assert.equal(collapsed(TREE), true)
  assert.equal(collapsed('agent-session:task'), false)
})

test('a Bot tree opened by hand stays open from storage alone', () => {
  writeGroupFold(TEAM, TREE, 'open')
  // A fresh read is what a swipe back, a remount or a restart sees.
  assert.equal(collapsed(TREE), false)
  writeGroupFold(TEAM, TREE, 'closed')
  assert.equal(collapsed(TREE), true)
})

test('Bot folds are per team', () => {
  writeGroupFold(TEAM, TREE, 'open')
  assert.equal(storedFoldCollapsed(loadGroupState('team-b'), { title: TREE }), true)
})

test('archiving a Bot forgets only its own folds', () => {
  const otherTree = botFoldTitle('bot-2')

  writeGroupFold(TEAM, TREE, 'open')
  writeGroupFold(TEAM, otherTree, 'open')
  writeGroupFold('team-b', TREE, 'open')
  forgetGroupFolds(TEAM, [TREE])

  assert.deepEqual(loadGroupState(TEAM), { [otherTree]: 'open' })
  assert.deepEqual(loadGroupState('team-b'), { [TREE]: 'open' })
})
