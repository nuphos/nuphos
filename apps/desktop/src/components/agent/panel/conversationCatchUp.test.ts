import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fetchWakeupTranscriptTail, shouldDeferTranscriptCatchUp } from './conversationCatchUp.ts'

test('fresh retry owns its transcript during the idle gap with no active backend run', () => {
  assert.equal(shouldDeferTranscriptCatchUp({ streaming: true, streamId: 'retry' }, null), true)
  assert.equal(
    shouldDeferTranscriptCatchUp({ streaming: true, streamId: 'retry' }, { streamId: 'retry' }),
    true,
  )
  assert.equal(shouldDeferTranscriptCatchUp({ streaming: false, streamId: null }, null), false)
  assert.equal(
    shouldDeferTranscriptCatchUp({ streaming: true, streamId: 'old' }, { streamId: 'new' }),
    false,
  )
})

test('does not fetch a failed-attempt transcript while its retry transport is open', async () => {
  const result = await fetchWakeupTranscriptTail(
    () => ({ streaming: true, messages: [] }),
    async () => {
      assert.fail('must not fetch stale history during retry')
    },
    1,
    100,
  )

  assert.equal(result, null)
})

test('discards a history response when a retry starts while it is in flight', async () => {
  const tab = { streaming: false, messages: [] }
  const result = await fetchWakeupTranscriptTail(
    () => tab,
    async () => {
      tab.streaming = true

      return { messagesFirstIndex: 0, messages: ['Turn failed'] }
    },
    1,
    100,
  )

  assert.equal(result, null)
})

test('discards an old response even if the new turn has already finished', async () => {
  let tab = { streaming: false, messages: ['old'] }
  const result = await fetchWakeupTranscriptTail(
    () => tab,
    async () => {
      tab = { streaming: false, messages: ['new answer'] }

      return { messagesFirstIndex: 0, messages: ['Turn failed'] }
    },
    1,
    100,
  )

  assert.equal(result, null)
})

test('refreshes settled transcripts and checks again after a full-tail fallback', async () => {
  const tab = { streaming: false, messages: ['prior'], historyBaseIndex: 0 }
  const calls: number[] = []
  const result = await fetchWakeupTranscriptTail(
    () => tab,
    async (tail) => {
      calls.push(tail)
      if (calls.length === 1) return { messagesFirstIndex: 3 }
      tab.streaming = true

      return { messagesFirstIndex: 0 }
    },
    2,
    100,
  )

  assert.deepEqual(calls, [2, 100])
  assert.equal(result, null)
  tab.streaming = false
  const detail = { messagesFirstIndex: 0 }

  assert.deepEqual(
    await fetchWakeupTranscriptTail(
      () => tab,
      async () => detail,
      2,
      100,
    ),
    { detail, latest: tab },
  )
})
