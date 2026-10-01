import { expect, test } from 'bun:test'

import { assertSingleNewUserMessage } from './message-input'

const user = (id: string) => ({ id, role: 'user' })

test('app sends cannot silently lose or leave unattributed new user messages', () => {
  expect(() =>
    assertSingleNewUserMessage([user('old'), user('new')], new Set(['old'])),
  ).not.toThrow()
  expect(() => assertSingleNewUserMessage([user('a'), user('b')], new Set())).toThrow(
    'one new user message',
  )
  expect(() =>
    assertSingleNewUserMessage([user('a'), { id: 'b', role: 'assistant' }], new Set()),
  ).toThrow('final message')
  expect(() => assertSingleNewUserMessage([user('old')], new Set(['old']))).not.toThrow()
})
