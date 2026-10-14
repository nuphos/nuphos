import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stampAssistantTurnEnd } from './messagePlacement.ts'

import type { Message } from './model'

const message = (id: string, role: Message['role'], createdAt?: number): Message => ({
  id,
  role,
  parts: [],
  ...(createdAt === undefined ? {} : { createdAt }),
})

test('stamps the finished reply even when messages from other sessions follow it', () => {
  const stamped = stampAssistantTurnEnd([
    message('u1', 'user', 1_000),
    message('a1', 'assistant'),
    message('t1', 'user', 2_000),
  ])

  assert.equal(typeof stamped[1].createdAt, 'number')
  assert.equal(stamped[2].createdAt, 2_000)
})

test('leaves a stamped reply and a transcript without replies alone', () => {
  const stamped = [message('a1', 'assistant', 1_000)]
  const users = [message('u1', 'user', 1_000)]

  assert.equal(stampAssistantTurnEnd(stamped), stamped)
  assert.equal(stampAssistantTurnEnd(users), users)
})
