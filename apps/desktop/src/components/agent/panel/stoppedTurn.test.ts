import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stoppedTurnCalls, withoutNoResponsePlaceholder } from './stoppedTurn.ts'

import type { Part } from './parts.ts'

let nextId = 0
const tool = (
  toolName = 'bash',
  state: 'output-available' | 'input-available' = 'output-available',
): Part => ({
  type: 'tool',
  toolCallId: `call-${String(++nextId)}`,
  toolName,
  state,
})
const text = (t: string): Part => ({ type: 'text', text: t })

test('a user stop counts the calls the turn made', () => {
  const parts = [tool(), tool(), tool('bash', 'input-available')]

  assert.equal(stoppedTurnCalls(parts, true), 3)
})

test('bookkeeping tools are not counted as calls', () => {
  const parts = [tool('skill'), tool('plan_get'), tool()]

  assert.equal(stoppedTurnCalls(parts, true), 1)
})

test('the runtime placeholder alone does not mark a turn as stopped', () => {
  const parts = [tool('send_message_to_thread'), text('_(no response)_')]

  assert.equal(stoppedTurnCalls(parts), null)
  assert.equal(stoppedTurnCalls(withoutNoResponsePlaceholder(parts)), null)
})

test('a turn with an interruption notice gets no stop line', () => {
  const interrupted: Part = {
    type: 'turn-interrupted',
    id: 'int-1',
    reason: 'cancelled',
    message: 'The turn was stopped before the agent finished.',
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  assert.equal(stoppedTurnCalls([tool(), interrupted], true), null)
})

test('the placeholder is dropped from rendered parts, other parts keep identity', () => {
  const parts = [tool(), text('(no response)')]

  assert.deepEqual(withoutNoResponsePlaceholder(parts), [parts[0]])
  const answered = [tool(), text('No response from the host.')]

  assert.equal(withoutNoResponsePlaceholder(answered), answered)
})
