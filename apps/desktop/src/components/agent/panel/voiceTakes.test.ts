import assert from 'node:assert/strict'
import test from 'node:test'

import { createTakes } from './voiceTakes.ts'

test('a take stopped with ■ lands its transcript in the field, once', () => {
  const takes = createTakes()
  const id = takes.begin()

  takes.stop()
  assert.deepEqual(takes.land(id, 'hello'), { send: false })
  assert.equal(takes.land(id, 'hello'), null)
})

test('↑ sends the transcript exactly once', () => {
  const takes = createTakes()
  const id = takes.begin()

  takes.stop({ send: true })
  assert.deepEqual(takes.land(id, 'ship it'), { send: true })
  assert.equal(takes.land(id, 'ship it'), null)
})

test('a discard while transcribing drops the transcript that arrives after it', () => {
  const takes = createTakes()
  const id = takes.begin()

  takes.stop({ send: true })
  takes.discard()
  assert.equal(takes.isCurrent(id), false)
  assert.equal(takes.land(id, 'too late'), null)
})

test('a new take started before the previous transcript arrives drops the old one', () => {
  const takes = createTakes()
  const first = takes.begin()

  takes.stop({ send: true })
  const second = takes.begin()

  assert.equal(takes.land(first, 'old words'), null)
  // The new take was not stopped with ↑, so it is not sent.
  takes.stop()
  assert.deepEqual(takes.land(second, 'new words'), { send: false })
})

test('an empty transcript lands nothing', () => {
  const takes = createTakes()
  const id = takes.begin()

  takes.stop()
  assert.equal(takes.land(id, '   '), null)
  assert.equal(takes.isCurrent(id), true)
})
