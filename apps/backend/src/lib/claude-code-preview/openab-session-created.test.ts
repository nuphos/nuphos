import { expect, test } from 'bun:test'

import { createdSession } from './openab-session-created'

const model = {
  id: 'claude-model',
  name: 'Model',
  category: 'model',
  currentValue: 'opus',
  options: [{ value: 'opus', name: 'Opus' }],
}

test('names the session and the settings it started with', () => {
  expect(createdSession({ sessionId: 'sess-1', configOptions: [model] })).toEqual({
    sessionId: 'sess-1',
    sessionConfig: [
      {
        id: 'claude-model',
        name: 'Model',
        kind: 'model',
        currentValue: 'opus',
        options: [{ value: 'opus', name: 'Opus' }],
      },
    ],
  })
})

test('a runtime that advertises no settings reports none, not an empty list', () => {
  expect(createdSession({ sessionId: 'sess-1' })).toEqual({ sessionId: 'sess-1' })
  expect(createdSession({ sessionId: 'sess-1', configOptions: [] })).toEqual({
    sessionId: 'sess-1',
  })
  expect(createdSession({ sessionId: 'sess-1', configOptions: 'model' })).toEqual({
    sessionId: 'sess-1',
  })
})

test('ignores entries the runtime did not shape like a control', () => {
  expect(createdSession({ sessionId: 'sess-1', configOptions: [null, 5, 'x', model] })).toEqual({
    sessionId: 'sess-1',
    sessionConfig: [
      {
        id: 'claude-model',
        name: 'Model',
        kind: 'model',
        currentValue: 'opus',
        options: [{ value: 'opus', name: 'Opus' }],
      },
    ],
  })
})

test('rejects a session without a usable id', () => {
  expect(() => createdSession({ sessionId: '' })).toThrow('invalid ACP session id')
  expect(() => createdSession({ sessionId: 42 })).toThrow('invalid ACP session id')
})
