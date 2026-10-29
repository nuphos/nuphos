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
  })
})

test('sends from the latest user message onward and advances baseIndex', () => {
  const messages = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3')]

  assert.deepEqual(windowTranscript(messages, undefined), {
    messages: [u('u3')],
    baseIndex: 4,
  })
})

test('keeps the in-flight assistant message after the latest user turn', () => {
  const messages = [u('u1'), a('a1'), u('u2'), a('a2-in-progress')]

  assert.deepEqual(windowTranscript(messages, undefined), {
    messages: [u('u2'), a('a2-in-progress')],
    baseIndex: 2,
  })
})

test('stacks on top of a paginated tail baseIndex', () => {
  const messages = [a('a9'), u('u10'), a('a10'), u('u11')]

  assert.deepEqual(windowTranscript(messages, 17), {
    messages: [u('u11')],
    baseIndex: 20,
  })
})

test('windows to the latest user message even when an earlier send was never stored', () => {
  // u2's send failed before the backend stored it: the store holds u1, a1 (2).
  // The tail must still carry only u3 — /chat accepts exactly one new user
  // message, so resending the unstored u2 alongside u3 would be rejected as
  // invalid_message_batch. The client's baseIndex (3) is then ahead of the
  // store (2); the 409 transcript_out_of_sync -> rebase path realigns it.
  const messages = [u('u1'), a('a1'), u('u2'), u('u3')]

  assert.deepEqual(windowTranscript(messages, undefined), {
    messages: [u('u3')],
    baseIndex: 3,
  })
})

test('windows to the latest user message when no reply was ever stored', () => {
  const messages = [u('u1'), u('u2')]

  assert.deepEqual(windowTranscript(messages, 0), {
    messages: [u('u2')],
    baseIndex: 1,
  })
})

test('the sent tail never carries more than one user message', () => {
  // The invariant the backend enforces (assertSingleNewUserMessage): a /chat
  // body holds exactly one new user message, as the final message. The window
  // must never produce a tail that violates it, whatever the local history.
  const histories = [
    [u('u1'), a('a1'), u('u2'), u('u3')],
    [u('u1'), u('u2')],
    [u('u1'), a('a1'), u('u2'), a('a2-in-progress')],
    [a('a9'), u('u10'), a('a10'), u('u11'), u('u12')],
    [u('u1'), a('a1'), u('u2'), a('a2'), u('u3')],
  ]

  for (const messages of histories) {
    const { messages: tail } = windowTranscript(messages, undefined)
    const users = tail.filter((message) => message.role === 'user')

    assert.ok(users.length <= 1, `tail carried ${String(users.length)} user messages`)
  }
})

test('passes through an empty transcript', () => {
  assert.deepEqual(windowTranscript([], 0), { messages: [], baseIndex: undefined })
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
