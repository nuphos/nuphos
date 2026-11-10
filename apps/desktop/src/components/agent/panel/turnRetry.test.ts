import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failedTurnPrompt } from './turnRetry.ts'

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

test('a failed or timed-out latest turn offers its prompt again', () => {
  assert.equal(failedTurnPrompt([asked('fix it'), failed('error')], undefined, false), 'fix it')
  assert.equal(failedTurnPrompt([asked('fix it'), failed('timeout')], undefined, false), 'fix it')
})

test('a stopped, finished or earlier turn offers nothing', () => {
  const answered: Message = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }

  assert.equal(
    failedTurnPrompt([asked('fix it'), failed('cancelled')], undefined, false),
    undefined,
  )
  assert.equal(failedTurnPrompt([asked('fix it'), answered], undefined, false), undefined)
  assert.equal(
    failedTurnPrompt([asked('one'), failed('error'), asked('two'), answered], undefined, false),
    undefined,
  )
  assert.equal(failedTurnPrompt([asked('pending')], undefined, false), undefined)
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

  assert.equal(failedTurnPrompt([theirs, failed('error')], 'me', true), undefined)
  assert.equal(failedTurnPrompt([theirs, failed('error')], 'teammate', true), 'their prompt')
})
