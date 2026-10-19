import { expect, test } from 'bun:test'

import { retractableAt } from './transcript-retract'

import type { MessageMetadata } from '@/lib/agent/message-metadata'

const sentBy = (id: string): MessageMetadata => ({
  version: 1,
  sender: { type: 'user', id, displayName: id },
  source: 'nuphos',
  sentAt: '2026-10-16T00:00:00.000Z',
})
const user = (messageId: string, sender = 'alice') => ({
  messageId,
  role: 'user' as const,
  parts: [{ type: 'text', text: 'hi' }],
  metadata: sentBy(sender),
})
const assistant = (...parts: unknown[]) => ({ messageId: 'a', role: 'assistant' as const, parts })
const earlier = [user('m0'), assistant({ type: 'text', text: 'Earlier answer' })]

test('the sender takes back a message whose turn left only an interruption', () => {
  const stored = [
    ...earlier,
    user('m1'),
    assistant({ type: 'turn-interrupted' }, { type: 'text', text: '(no response)' }),
  ]

  expect(retractableAt(stored, 'm1', 'alice', 'owner')).toEqual({ outcome: 'retracted', index: 2 })
  expect(retractableAt([...earlier, user('m1')], 'm1', 'alice', 'owner')).toEqual({
    outcome: 'retracted',
    index: 2,
  })
})

test('another participant cannot take back the message', () => {
  expect(retractableAt([user('m1')], 'm1', 'bob', 'owner').outcome).toBe('not_sender')
})

test('a legacy message without a sender belongs to the owner', () => {
  const legacy = [{ ...user('m1'), metadata: undefined }]

  expect(retractableAt(legacy, 'm1', 'owner', 'owner').outcome).toBe('retracted')
  expect(retractableAt(legacy, 'm1', 'alice', 'owner').outcome).toBe('not_sender')
})

test('any output, steer or later message keeps the message', () => {
  for (const after of [
    assistant({ type: 'text', text: 'Looking' }),
    assistant({ type: 'reasoning', text: 'Thinking' }),
    assistant({ type: 'tool-bash', toolCallId: 't' }),
    assistant({ type: 'data-steering' }),
    user('m2'),
  ])
    expect(retractableAt([user('m1'), after], 'm1', 'alice', 'owner').outcome).toBe('answered')
})

test('an unknown or assistant message is not found', () => {
  expect(retractableAt(earlier, 'nope', 'alice', 'owner').outcome).toBe('not_found')
  expect(retractableAt(earlier, 'a', 'alice', 'owner').outcome).toBe('not_found')
})
