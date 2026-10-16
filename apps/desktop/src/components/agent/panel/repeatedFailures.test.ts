import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collapseRepeatedFailures } from './repeatedFailures.ts'

import type { Message } from './model.ts'

const LIMIT = "You've hit your session limit · resets 4:20am (UTC)"
const asked = (id: string): Message => ({ id, role: 'user', parts: [{ type: 'text', text: id }] })
const failed = (id: string, message = LIMIT): Message => ({
  id,
  role: 'assistant',
  parts: [
    { type: 'step-start' },
    { type: 'turn-interrupted', id: `${id}:i`, reason: 'error', message, createdAt: '' },
  ],
})
const ids = (messages: Message[]) => messages.map((m) => m.id)
const repeats = (message: Message | undefined) =>
  message?.parts.find((p) => p.type === 'turn-interrupted')?.repeats

test('identical failed turns in a row leave one line that counts them', () => {
  const out = collapseRepeatedFailures([
    asked('q1'),
    failed('a1'),
    asked('q2'),
    failed('a2'),
    asked('q3'),
    failed('a3'),
  ])

  assert.deepEqual(ids(out), ['q1', 'q2', 'q3', 'a3'])
  assert.equal(repeats(out.at(-1)), 3)
})

test('a different failure or a real answer starts a new run', () => {
  const answer: Message = { id: 'ok', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
  const out = collapseRepeatedFailures([
    failed('a1'),
    answer,
    failed('a2'),
    failed('a3', 'The agent failed before it could answer.'),
  ])

  assert.deepEqual(ids(out), ['a1', 'ok', 'a2', 'a3'])
  assert.equal(
    out.some((m) => repeats(m)),
    false,
  )
})

test('a failure after partial output is not collapsed', () => {
  const partial: Message = {
    ...failed('a2'),
    parts: [{ type: 'text', text: 'Checking.' }, ...failed('a2').parts],
  }

  assert.deepEqual(ids(collapseRepeatedFailures([failed('a1'), partial])), ['a1', 'a2'])
})
