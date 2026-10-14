import assert from 'node:assert/strict'
import { test } from 'node:test'

import { placeTimelineEvents } from './timelineEvents.ts'

const event = (text: string, at: number) => ({
  kind: 'participant_invited',
  at: new Date(at).toISOString(),
  text,
})
const messages = [{ id: 'a', createdAt: 1_000 }, { id: 'b', createdAt: 3_000 }, { id: 'live' }]

test('an event goes before the first message newer than it', () => {
  const { before, trailing } = placeTimelineEvents(messages, [
    event('early', 500),
    event('mid', 2_000),
  ])

  assert.deepEqual(
    before.get('a')?.map((e) => e.text),
    ['early'],
  )
  assert.deepEqual(
    before.get('b')?.map((e) => e.text),
    ['mid'],
  )
  assert.deepEqual(trailing, [])
})

test('a streaming message counts as the newest, and nothing newer trails it', () => {
  const { before, trailing } = placeTimelineEvents(messages, [event('late', 9_000)])

  assert.deepEqual(
    before.get('live')?.map((e) => e.text),
    ['late'],
  )
  assert.deepEqual(trailing, [])
  assert.deepEqual(
    placeTimelineEvents(messages.slice(0, 2), [event('late', 9_000)]).trailing.length,
    1,
  )
})

test('an event during an autonomous turn sits before its reply, live and stored', () => {
  // No user message starts the turn; the previous reply's turn-end stamp is
  // the boundary, and the autonomous reply is unstamped until read back.
  const live = [{ id: 'a1', createdAt: 1_000 }, { id: 'a2' }]
  const stored = [
    { id: 'a1', createdAt: 1_000 },
    { id: 'a2', createdAt: 5_000 },
  ]

  for (const messages of [live, stored]) {
    const { before, trailing } = placeTimelineEvents(messages, [event('during', 4_000)])

    assert.deepEqual(
      before.get('a2')?.map((e) => e.text),
      ['during'],
    )
    assert.deepEqual(trailing, [])
  }
})

test('an event older than the loaded page waits for earlier history', () => {
  assert.equal(placeTimelineEvents(messages, [event('early', 500)], true).before.size, 0)
})
