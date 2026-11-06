import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chatPreview, chatTime } from './chat-preview.ts'

test('a chat with no messages has no preview', () => {
  assert.equal(chatPreview(undefined), undefined)
})

test('markdown and mention links read as plain text', () => {
  assert.equal(
    chatPreview({ text: '**Done**: see [the PR](https://x/1) for [@Ann](#mention:ann)\n- ok' }),
    'Done: see the PR for @Ann ok',
  )
})

test('a group chat names the sender', () => {
  assert.equal(chatPreview({ text: 'hi', from: 'Ann' }), 'Ann: hi')
})

test('a file-only message reads Attachment', () => {
  assert.equal(chatPreview({ text: '' }), 'Attachment')
  assert.equal(chatPreview({ text: '', from: 'Ann' }), 'Ann: Attachment')
})

test('a chat time reads like iMessage: time, Yesterday, weekday, then date', () => {
  const now = new Date(2026, 10, 6, 14, 0)
  const at = (day: number, hour = 9) => new Date(2026, 10, day, hour, 5).toISOString()
  const clock = { hour: 'numeric', minute: '2-digit' } as const

  assert.equal(
    chatTime(at(6), now),
    new Date(2026, 10, 6, 9, 5).toLocaleTimeString(undefined, clock),
  )
  assert.equal(chatTime(at(5, 23), now), 'Yesterday')
  assert.equal(
    chatTime(at(2), now),
    new Date(2026, 10, 2).toLocaleDateString(undefined, { weekday: 'long' }),
  )
  assert.match(chatTime(new Date(2026, 9, 20).toISOString(), now) ?? '', /26/)
  assert.equal(chatTime('not a date', now), undefined)
})
