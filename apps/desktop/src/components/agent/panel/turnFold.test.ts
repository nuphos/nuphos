import assert from 'node:assert/strict'
import { test } from 'node:test'

import { turnFoldSplitIndex } from './turnFold.ts'

import type { Part, ToolPart } from './parts.ts'

let nextId = 0
const tool = (state: ToolPart['state'] = 'output-available'): Part => ({
  type: 'tool',
  toolCallId: `call-${String(++nextId)}`,
  toolName: 'bash',
  state,
})
const text = (t: string): Part => ({ type: 'text', text: t })
const interrupted = (reason: 'cancelled' | 'timeout' | 'error'): Part => ({
  type: 'turn-interrupted',
  id: `int-${String(++nextId)}`,
  reason,
  message: 'The agent did not respond in time.',
  createdAt: '2026-01-01T00:00:00.000Z',
})

test('a timed-out turn folds its work and leaves the notice outside the fold', () => {
  const parts = [text('Checking.'), tool(), tool(), interrupted('timeout')]

  assert.equal(turnFoldSplitIndex(parts, { streaming: false }), 3)
})

test('a turn cut off with no output at all still folds behind the notice', () => {
  const parts = [tool(), tool('input-available'), interrupted('error')]

  assert.equal(turnFoldSplitIndex(parts, { streaming: false }), 2)
})

test('final answer text stays outside the fold with the notice', () => {
  const parts = [tool(), tool(), text('Here is what I got before it died.'), interrupted('error')]

  assert.equal(turnFoldSplitIndex(parts, { streaming: false }), 2)
})

test('a turn the user stopped folds like a completed one', () => {
  const parts = [text('On it.'), tool(), tool()]

  assert.equal(turnFoldSplitIndex(parts, { streaming: false, stoppedByUser: true }), 3)
})

test('an approval the user can still answer keeps the turn expanded', () => {
  const parts = [tool(), tool('approval-requested'), interrupted('timeout')]

  assert.equal(turnFoldSplitIndex(parts, { streaming: false }), -1)
  assert.equal(turnFoldSplitIndex(parts, { streaming: false, stoppedByUser: true }), -1)
})

test('a live turn never folds, streaming or steering', () => {
  const parts = [text('Checking.'), tool(), tool(), interrupted('timeout')]

  assert.equal(turnFoldSplitIndex(parts, { streaming: true }), -1)
  const steered: Part[] = [
    text('Checking.'),
    { type: 'data-steering', data: { id: 's1', text: 'actually, stop' } },
    tool(),
    interrupted('cancelled'),
  ]

  assert.equal(turnFoldSplitIndex(steered, { streaming: false }), 0)
})

test('a cleanly finished turn still folds at its final answer', () => {
  const parts = [tool(), tool(), text('Done.')]

  assert.equal(turnFoldSplitIndex(parts, { streaming: false }), 2)
})
