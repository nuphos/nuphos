import assert from 'node:assert/strict'
import test from 'node:test'

import { teamCanUseAgent } from './agentAccess.ts'

test('any workspace can use the OpenAB agent without an active plan', () => {
  assert.equal(teamCanUseAgent({ id: 't', name: 'Team', agentRuntime: 'claude-code' }), true)
  assert.equal(
    teamCanUseAgent({ id: 't', name: 'Team', billing: { active: false, activated: true } }),
    true,
  )
  assert.equal(
    teamCanUseAgent({ id: 't', name: 'Team', billing: { active: true, activated: true } }),
    true,
  )
})

test('the selected OpenAB runtime can use Agent on the free plan', () => {
  assert.equal(
    teamCanUseAgent({
      id: 't',
      name: 'Team',
      agentRuntime: 'claude-code',
      billing: { active: false, activated: false },
    }),
    true,
  )
})
