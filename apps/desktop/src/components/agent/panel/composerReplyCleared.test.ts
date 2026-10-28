import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  claimClearedReplies,
  clearClearedReplies,
  loadClearedReplies,
  saveClearedReplies,
} from './composerReplyCleared.ts'

function memory() {
  const items = new Map<string, string>()

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

test('cleared questions are kept per conversation for the signed-in account', () => {
  const storage = memory()

  saveClearedReplies('team:a', ['q1'], storage)
  assert.deepEqual(loadClearedReplies('team:a', storage), [], 'nothing is kept before sign-in')
  claimClearedReplies('user-1', storage)
  saveClearedReplies('team:a', ['q1'], storage)
  saveClearedReplies('team:b', ['q2'], storage)
  assert.deepEqual(loadClearedReplies('team:a', storage), ['q1'])
  assert.deepEqual(loadClearedReplies('team:b', storage), ['q2'])
  claimClearedReplies('user-1', storage)
  assert.deepEqual(loadClearedReplies('team:a', storage), ['q1'])
  claimClearedReplies('user-2', storage)
  assert.deepEqual(loadClearedReplies('team:a', storage), [], "another account's are dropped")
})

test('an empty list removes the conversation and sign-out clears everything', () => {
  const storage = memory()

  claimClearedReplies('user-1', storage)
  saveClearedReplies('team:a', ['q1'], storage)
  saveClearedReplies('team:a', [], storage)
  assert.deepEqual(loadClearedReplies('team:a', storage), [])
  saveClearedReplies('team:a', ['q1'], storage)
  clearClearedReplies(storage)
  assert.deepEqual(loadClearedReplies('team:a', storage), [])
})

test('only the 50 most recently changed conversations are kept', () => {
  const storage = memory()

  claimClearedReplies('user-1', storage)
  for (let index = 0; index < 55; index++)
    saveClearedReplies(`team:${String(index)}`, ['q'], storage, index)
  assert.deepEqual(loadClearedReplies('team:4', storage), [])
  assert.deepEqual(loadClearedReplies('team:5', storage), ['q'])
  assert.deepEqual(loadClearedReplies('team:54', storage), ['q'])
})

test('unreadable storage reads as nothing cleared', () => {
  const storage = memory()

  storage.setItem('nuphos.agent.clearedReplies.v1', '{not json')
  assert.deepEqual(loadClearedReplies('team:a', storage), [])
})
