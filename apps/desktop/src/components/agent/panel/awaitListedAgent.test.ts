import assert from 'node:assert/strict'
import { test } from 'node:test'

import { awaitListedAgent } from './awaitListedAgent.ts'

import type { RuntimeInstance } from '../../../types/runtime.ts'

const local: RuntimeInstance = {
  id: 'local_u1_mac',
  provider: 'claude-code',
  label: 'MacBook · Claude Code',
  status: 'active',
  kind: 'local',
  createdAt: '',
}

test('sends once the catalog lists this computer’s agent', async () => {
  let calls = 0
  const listed = await awaitListedAgent(
    local.id,
    () => Promise.resolve(++calls < 3 ? [] : [local]),
    () => Promise.resolve(),
  )

  assert.equal(listed?.id, local.id)
  assert.equal(calls, 3)
})

test('gives up when the agent never comes online', async () => {
  const listed = await awaitListedAgent(
    local.id,
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve(),
    1_000,
  )

  assert.equal(listed, null)
})
