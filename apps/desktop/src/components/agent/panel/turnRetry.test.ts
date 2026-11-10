import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failedTurn } from './turnRetry.ts'

import type { Message } from './model.ts'
import type { TurnInterruptedPart } from './parts.ts'

const asked = (text: string): Message => ({
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text }],
})
const failed = (reason: TurnInterruptedPart['reason']): Message => ({
  id: 'a',
  role: 'assistant',
  parts: [
    { type: 'text', text: 'partial' },
    { type: 'turn-interrupted', id: 'i', reason, message: 'boom', createdAt: '' },
  ],
})

test('a failed or timed-out latest turn offers its prompt again, on its own line', () => {
  for (const reason of ['error', 'timeout'] as const) {
    assert.deepEqual(failedTurn([asked('fix it'), failed(reason)], undefined, false), {
      partId: 'i',
      prompt: 'fix it',
    })
  }
})

test('a stopped, finished or earlier turn offers nothing', () => {
  const answered: Message = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }

  assert.equal(failedTurn([asked('fix it'), failed('cancelled')], undefined, false), undefined)
  assert.equal(failedTurn([asked('fix it'), answered], undefined, false), undefined)
  assert.equal(
    failedTurn([asked('one'), failed('error'), asked('two'), answered], undefined, false),
    undefined,
  )
  assert.equal(failedTurn([asked('pending')], undefined, false), undefined)
})

test('a prompt with an attachment is not resent as text alone', () => {
  const withFile: Message = {
    id: 'u',
    role: 'user',
    parts: [
      { type: 'text', text: 'summarize the attached report' },
      { type: 'local-file', path: '/Users/me/Documents/report.pdf' },
    ],
  }

  assert.equal(failedTurn([withFile, failed('error')], undefined, false), undefined)
})

test('someone else’s prompt in a shared chat is not resent by the viewer', () => {
  const theirs: Message = {
    ...asked('their prompt'),
    metadata: {
      version: 1,
      sender: { type: 'user', id: 'teammate', displayName: 'Teammate' },
      source: 'nuphos',
      sentAt: '',
    } as Message['metadata'],
  }

  assert.equal(failedTurn([theirs, failed('error')], 'me', true), undefined)
  assert.equal(failedTurn([theirs, failed('error')], 'teammate', true)?.prompt, 'their prompt')
})
