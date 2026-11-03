import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sendingPost, stillSending } from './sendingPosts.ts'

import type { UserInfo } from '../../types'

const user = { id: 'u1', name: 'Mei', username: 'mei', avatarURL: '' } as UserInfo

test('a sent post shows at once as the viewer’s own text', () => {
  const post = sendingPost('p1', 'hello', user)

  assert.equal(post.id, 'p1')
  assert.deepEqual(post.parts, [{ type: 'text', text: 'hello' }])
  assert.equal(post.metadata?.sender.id, 'u1')
  assert.equal(post.metadata?.sender.displayName, 'Mei')
})

test('a post leaves the sending list once the channel returns it', () => {
  const a = sendingPost('a', 'one', user)
  const b = sendingPost('b', 'two', user)
  const sending = [a, b]

  assert.equal(stillSending([], sending), sending)
  assert.deepEqual(stillSending([{ ...a, createdAt: 'now' }], sending), [b])
})

test('a post with files shows their uploading card, with or without words', () => {
  const card = { type: 'transfer-upload', groupId: '', status: 'uploading', files: [] }

  assert.deepEqual(sendingPost('p2', '', user, card).parts, [card])
  assert.deepEqual(sendingPost('p3', 'look', user, card).parts, [
    { type: 'text', text: 'look' },
    card,
  ])
})
