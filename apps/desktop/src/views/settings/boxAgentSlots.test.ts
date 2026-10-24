import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentSlots } from './boxAgentSlots.ts'

test('an empty list never waits forever: setup for This computer, plain empty elsewhere', () => {
  assert.equal(agentSlots(true, false, 'running', []), 'noLocalAgent')
  assert.equal(agentSlots(false, false, 'running', []), 'agents')
  assert.equal(agentSlots(false, true, 'running', []), 'starting')
  assert.equal(agentSlots(true, true, 'running', []), 'starting')
  assert.equal(agentSlots(true, false, 'paused', []), 'agents')
})
