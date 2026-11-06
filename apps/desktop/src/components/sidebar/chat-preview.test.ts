import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chatPreview } from './chat-preview.ts'

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
