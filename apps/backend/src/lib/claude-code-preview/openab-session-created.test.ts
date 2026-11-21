import { expect, test } from 'bun:test'

import { createdSession } from './openab-session-created'

test('names the session', () => {
  expect(createdSession({ sessionId: 'sess-1' })).toEqual({ sessionId: 'sess-1' })
})

test('rejects a session without a usable id', () => {
  expect(() => createdSession({ sessionId: '' })).toThrow('invalid ACP session id')
  expect(() => createdSession({ sessionId: 42 })).toThrow('invalid ACP session id')
})
