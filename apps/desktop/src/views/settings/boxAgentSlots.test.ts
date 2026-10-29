import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentSlots, canAddAgent } from './boxAgentSlots.ts'

test('an empty list never waits forever: setup for This computer, plain empty elsewhere', () => {
  assert.equal(agentSlots(true, false, 'running', []), 'noLocalAgent')
  assert.equal(agentSlots(false, false, 'running', []), 'agents')
  assert.equal(agentSlots(false, true, 'running', []), 'starting')
  assert.equal(agentSlots(true, true, 'running', []), 'starting')
  assert.equal(agentSlots(true, false, 'paused', []), 'agents')
})

test('+ shows on any running machine, shared ones too, and nowhere else', () => {
  // canAddAgent takes no access level: 'use' and 'manage' viewers get the same answer.
  assert.equal(canAddAgent('running'), true)
  for (const state of [
    'paused',
    'stopped',
    'hostOffline',
    'creating',
    'connecting',
    'error',
  ] as const)
    assert.equal(canAddAgent(state), false, state)
})
