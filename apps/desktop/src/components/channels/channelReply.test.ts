import assert from 'node:assert/strict'
import { test } from 'node:test'

import { replyTo } from './channelReply.ts'

const metadata = {
  version: 1,
  sender: { type: 'user', id: 'u1', displayName: 'Mei' },
  source: 'nuphos',
  sentAt: '2026-11-07T00:00:00Z',
}

test('a reply quotes its post’s author and the start of its words', () => {
  const post = {
    id: 'p1',
    role: 'user',
    parts: [{ type: 'text', text: 'x'.repeat(250) }],
    metadata,
  }

  assert.deepEqual(replyTo(post as never), { id: 'p1', authorName: 'Mei', text: 'x'.repeat(200) })
})

test('a post of files alone is quoted as its file; one with no sender is not quoted', () => {
  assert.equal(replyTo({ id: 'p2', role: 'user', parts: [], metadata } as never)?.text, 'File')
  assert.equal(replyTo({ id: 'p3', role: 'user', parts: [] } as never), null)
})
