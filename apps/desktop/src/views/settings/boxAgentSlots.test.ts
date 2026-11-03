import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentSlots, askToAdd, canAddAgent } from './boxAgentSlots.ts'

test('an empty list never waits forever: setup for This computer, plain empty elsewhere', () => {
  assert.equal(agentSlots(true, false, 'running', []), 'noLocalAgent')
  assert.equal(agentSlots(false, false, 'running', []), 'agents')
  assert.equal(agentSlots(false, true, 'running', []), 'starting')
  assert.equal(agentSlots(true, true, 'running', []), 'starting')
  assert.equal(agentSlots(true, false, 'paused', []), 'agents')
})

test('+ shows on a running machine the viewer manages, and nowhere else', () => {
  assert.equal(canAddAgent('running', true), true)
  assert.equal(canAddAgent('running', false), false)
  for (const state of [
    'paused',
    'stopped',
    'hostOffline',
    'creating',
    'connecting',
    'error',
  ] as const)
    assert.equal(canAddAgent(state, true), false, state)
})

test('someone who may only use a running machine is told whom to ask instead', () => {
  assert.equal(askToAdd('running', false, { name: 'alice@demo.test' }), 'Ask alice@demo.test')
  assert.equal(askToAdd('running', false, { name: null }), 'Ask the owner')
  assert.equal(askToAdd('running', false, null), 'Ask the owner')
  assert.equal(askToAdd('running', true, { name: 'alice@demo.test' }), undefined)
  assert.equal(askToAdd('paused', false, { name: 'alice@demo.test' }), undefined)
})
