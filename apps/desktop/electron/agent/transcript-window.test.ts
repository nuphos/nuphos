import assert from 'node:assert/strict'
import { test } from 'node:test'

import { storedMessageCountFromDetails, windowTranscript } from './transcript-window.ts'

const u = (id: string) => ({ id, role: 'user' as const })
const a = (id: string) => ({ id, role: 'assistant' as const })

test('keeps the full transcript when the only user message is first', () => {
  const messages = [u('u1'), a('a1')]

  assert.deepEqual(windowTranscript(messages, undefined), {
    messages,
    baseIndex: undefined,
    dropped: 0,
  })
})

test('sends from the latest user message onward and advances baseIndex', () => {
  const messages = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3')]

  assert.deepEqual(windowTranscript(messages, undefined), {
    messages: [u('u3')],
    baseIndex: 4,
    dropped: 4,
  })
})

test('keeps the in-flight assistant message after the latest user turn', () => {
  const messages = [u('u1'), a('a1'), u('u2'), a('a2-in-progress')]

  assert.deepEqual(windowTranscript(messages, undefined), {
    messages: [u('u2'), a('a2-in-progress')],
    baseIndex: 2,
    dropped: 2,
  })
})

test('stacks on top of a paginated tail baseIndex', () => {
  const messages = [a('a9'), u('u10'), a('a10'), u('u11')]

  assert.deepEqual(windowTranscript(messages, 17), {
    messages: [u('u11')],
    baseIndex: 20,
    dropped: 3,
  })
})

test('passes through an empty transcript', () => {
  assert.deepEqual(windowTranscript([], 0), { messages: [], baseIndex: undefined, dropped: 0 })
})

test('extracts the stored message count from a 409 error payload', () => {
  assert.equal(storedMessageCountFromDetails({ storedMessageCount: 166 }), 166)
  assert.equal(storedMessageCountFromDetails({ storedMessageCount: 0 }), 0)
})

test('rejects malformed stored-count payloads', () => {
  assert.equal(storedMessageCountFromDetails(undefined), undefined)
  assert.equal(storedMessageCountFromDetails(null), undefined)
  assert.equal(storedMessageCountFromDetails('166'), undefined)
  assert.equal(storedMessageCountFromDetails({ storedMessageCount: -1 }), undefined)
  assert.equal(storedMessageCountFromDetails({ storedMessageCount: 1.5 }), undefined)
  assert.equal(storedMessageCountFromDetails({}), undefined)
})
