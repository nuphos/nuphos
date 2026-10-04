import assert from 'node:assert/strict'
import { test } from 'node:test'

import { localAgentReady, pendingLocalAgents } from './localAgentReady.ts'

import type { AgentCliStatus, LocalRuntimeState } from '../api/device-types.ts'

function state(claude: AgentCliStatus | null, codex: AgentCliStatus | null): LocalRuntimeState {
  const agent = (cli: AgentCliStatus | null) => ({ available: true, online: false, cli })

  return {
    agents: { 'claude-code': agent(claude), codex: agent(codex) },
    workspace: '/w',
    userId: 'u1',
  }
}

const missing: AgentCliStatus = { installed: false }
const signedIn: AgentCliStatus = { installed: true, path: '/bin/claude', loggedIn: true }
const signedOut: AgentCliStatus = { installed: true, path: '/bin/codex', loggedIn: false }

test('ready once any agent CLI is installed and signed in', () => {
  assert.equal(localAgentReady(state(signedIn, missing)), true)
  assert.equal(localAgentReady(state(missing, signedOut)), false)
  assert.equal(localAgentReady(state(missing, missing)), false)
})

test('unknown while the CLIs are still being checked or nobody is signed in', () => {
  assert.equal(localAgentReady(state(null, missing)), null)
  assert.equal(localAgentReady(null), null)
  assert.equal(localAgentReady({ ...state(missing, missing), userId: null }), null)
})

test('signed-out local Claude remains selectable for sign-in without duplicating catalog entries', () => {
  const local = { ...state(signedOut, signedOut), deviceId: 'device' }
  const pending = pendingLocalAgents(local, [])

  assert.equal(pending.length, 1)
  assert.equal(pending[0].provider, 'claude-code')
  assert.equal(pending[0].local?.signedIn, false)
  assert.deepEqual(pendingLocalAgents(local, pending), [])
})
