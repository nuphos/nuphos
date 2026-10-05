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

test('an event older than the loaded page waits for earlier history', () => {
  assert.equal(placeTimelineEvents(messages, [event('early', 500)], true).before.size, 0)
})
