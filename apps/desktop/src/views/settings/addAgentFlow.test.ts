import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextAddAgentStep } from './addAgentFlow.ts'

test('the two choices lead to the self-hosted connect and the managed type choice', () => {
  assert.equal(nextAddAgentStep('choose', 'self-hosted'), 'self-hosted')
  assert.equal(nextAddAgentStep('choose', 'managed'), 'managed')
})

test('self-hosted keeps the pairing code first and the password as the fallback', () => {
  assert.equal(nextAddAgentStep('self-hosted', 'use-password'), 'self-hosted-password')
  assert.equal(nextAddAgentStep('self-hosted-password', 'use-pairing'), 'self-hosted')
  assert.equal(nextAddAgentStep('self-hosted-password', 'back'), 'self-hosted')
  assert.equal(nextAddAgentStep('self-hosted', 'back'), 'choose')
  assert.equal(nextAddAgentStep('managed', 'back'), 'choose')
})
