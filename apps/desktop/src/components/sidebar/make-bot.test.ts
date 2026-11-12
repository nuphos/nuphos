import assert from 'node:assert/strict'
import test from 'node:test'

import { canBecomeBot } from './make-bot.ts'

test('a top-level Task can become a Bot', () => {
  assert.equal(canBecomeBot({ task: true }), true)
})

test('a sub-task cannot become a Bot', () => {
  assert.equal(canBecomeBot({ task: true, parentKey: 'agent-session:parent' }), false)
})

test('a Bot, a read-only chat and a non-Task row cannot become a Bot', () => {
  assert.equal(canBecomeBot({ task: true, bot: true }), false)
  assert.equal(canBecomeBot({ task: true, readOnlyChat: true }), false)
  assert.equal(canBecomeBot({}), false)
})
