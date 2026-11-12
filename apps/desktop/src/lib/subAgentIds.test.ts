import assert from 'node:assert/strict'
import test from 'node:test'

import { isSubAgent, receiveSubAgents } from './subAgentIds.ts'

test('a conversation with a parent is a sub-task until a fetch says otherwise', () => {
  receiveSubAgents([{ sessionId: 'child', parentSessionId: 'parent' }, { sessionId: 'parent' }])
  assert.equal(isSubAgent('child'), true)
  assert.equal(isSubAgent('parent'), false)

  // A fetch that leaves it out changes nothing; one without its parent clears it.
  receiveSubAgents([{ sessionId: 'other' }])
  assert.equal(isSubAgent('child'), true)
  receiveSubAgents([{ sessionId: 'child' }])
  assert.equal(isSubAgent('child'), false)
})
