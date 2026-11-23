import assert from 'node:assert/strict'
import { test } from 'node:test'

import { homeGreeting } from './textUtils.ts'

test('greets the user by the first word of their display name', () => {
  assert.equal(homeGreeting('Yuanlin Lin'), "What's up next, Yuanlin?")
  assert.equal(homeGreeting('  Ada  '), "What's up next, Ada?")
})

test('drops the name when there is none', () => {
  assert.equal(homeGreeting(undefined), "What's up next?")
  assert.equal(homeGreeting('   '), "What's up next?")
})
