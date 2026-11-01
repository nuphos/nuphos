import assert from 'node:assert/strict'
import { test } from 'node:test'

import { localAgentStatus, readyLocalAgents } from './agentSetup.ts'

import type { LocalRuntimeState } from '../../../api/device-types.ts'

const installed = (loggedIn: boolean | null) =>
  ({ installed: true, path: '/usr/local/bin/agent', loggedIn }) as const

test('a local agent is ready only when its CLI is installed and signed in', () => {
  assert.equal(localAgentStatus(null), 'checking')
  assert.equal(localAgentStatus(undefined), 'checking')
  assert.equal(localAgentStatus({ installed: false }), 'missing')
  assert.equal(localAgentStatus(installed(false)), 'signed-out')
  assert.equal(localAgentStatus(installed(null)), 'signed-out')
  assert.equal(localAgentStatus(installed(true)), 'ready')
})

test('ready local agents keep the Claude Code, Codex order', () => {
  const state = {
    agents: {
      'claude-code': { available: true, online: false, cli: installed(true) },
      codex: { available: true, online: true, cli: installed(true) },
    },
    workspace: null,
    userId: 'u1',
  } satisfies LocalRuntimeState

  assert.deepEqual(readyLocalAgents(state), ['claude-code', 'codex'])
  assert.deepEqual(
    readyLocalAgents({
      ...state,
      agents: { ...state.agents, codex: { ...state.agents.codex, cli: { installed: false } } },
    }),
    ['claude-code'],
  )
  assert.deepEqual(readyLocalAgents(null), [])
})
