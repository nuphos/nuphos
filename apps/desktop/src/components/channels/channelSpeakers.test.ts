import assert from 'node:assert/strict'
import { test } from 'node:test'

import { speaksInChannel } from './channelSpeakers.ts'

test('a person and an agent speak in a channel', () => {
  assert.equal(speaksInChannel({ type: 'user' }), true)
  assert.equal(speaksInChannel({ type: 'agent' }), true)
})

test('a system notice is never a channel post', () => {
  assert.equal(speaksInChannel({ type: 'system' }), false)
})
