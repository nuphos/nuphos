import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isChannelRecord, speaksInChannel } from './channelSpeakers.ts'

test('a person and an agent speak in a channel', () => {
  assert.equal(speaksInChannel({ type: 'user' }), true)
  assert.equal(speaksInChannel({ type: 'agent' }), true)
})

test('a system notice is never a channel post', () => {
  assert.equal(speaksInChannel({ type: 'system' }), false)
})

test("an answer to a question and a change of owner are a chat's records; other notices are not", () => {
  assert.equal(isChannelRecord({ id: 'nuphos:decision' }), true)
  assert.equal(isChannelRecord({ id: 'nuphos:chat' }), true)
  assert.equal(isChannelRecord({ id: 'nuphos' }), false)
})
