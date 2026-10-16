import assert from 'node:assert/strict'
import test from 'node:test'

import { canEditMessage } from './messageEdit.ts'

import type { Message } from './model'

const from = (id: string) => ({ metadata: { sender: { id } } }) as unknown as Message

test("your own messages are editable, a teammate's or a Slack sender's are not", () => {
  assert.equal(canEditMessage(from('me'), 'me', false), true)
  assert.equal(canEditMessage(from('teammate'), 'me', false), false)
  // An invited participant edits their own messages in someone else's chat.
  assert.equal(canEditMessage(from('me'), 'me', true), true)
})

test('a message without a sender belongs to the chat owner', () => {
  assert.equal(canEditMessage({}, 'me', false), true)
  assert.equal(canEditMessage({}, 'me', true), false)
})

test('a plan approval is never editable', () => {
  assert.equal(canEditMessage({ ...from('me'), turnKind: 'plan-approval' }, 'me', false), false)
})
