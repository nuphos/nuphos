import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  localAgentStatus,
  managedRuntimePlan,
  newlyConnectedAgent,
  readyLocalAgents,
  setupStep,
} from './agentSetup.ts'
import { SELF_HOSTED_PLATFORM_IDS, SELF_HOSTED_PLATFORMS } from './selfHostedPlatforms.ts'

import type { LocalRuntimeState } from '../../../api/device-types.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

const agent = (id: string, kind: RuntimeInstance['kind']) =>
  ({ id, kind, provider: 'codex', label: id, status: 'active', createdAt: '' }) as RuntimeInstance

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

test('the Nuphos Cloud picker reuses its unsigned agent and replaces it when the agent changes', () => {
  const claude = { ...agent('c1', 'managed'), provider: 'claude-code' } as RuntimeInstance

  assert.deepEqual(managedRuntimePlan(null, 'codex'), { kind: 'create', replace: null })
  assert.deepEqual(managedRuntimePlan(claude, 'claude-code'), { kind: 'reuse', instance: claude })
  assert.deepEqual(managedRuntimePlan(claude, 'codex'), { kind: 'create', replace: claude })
})

test('a self-hosted agent counts as new only when it was not there before', () => {
  const known = new Set(['old'])

  assert.equal(newlyConnectedAgent(undefined, [agent('new', 'external')]), undefined)
  assert.equal(newlyConnectedAgent(known, [agent('old', 'external')]), undefined)
  assert.equal(newlyConnectedAgent(known, [agent('m', 'managed')]), undefined)
  assert.equal(
    newlyConnectedAgent(known, [agent('old', 'external'), agent('new', 'external')])?.id,
    'new',
  )
})

test('the stepper marks local first and every cloud screen second', () => {
  assert.equal(setupStep('local'), 1)
  assert.equal(setupStep('cloud'), 2)
  assert.equal(setupStep('managed'), 2)
  assert.equal(setupStep('self-hosted'), 2)
  assert.equal(setupStep('done'), undefined)
})

test('self-hosted platforms are exactly Zeabur, Railway and Docker Compose, each with an https link', () => {
  assert.deepEqual(SELF_HOSTED_PLATFORM_IDS, ['zeabur', 'railway', 'compose'])
  for (const id of SELF_HOSTED_PLATFORM_IDS)
    assert.equal(new URL(SELF_HOSTED_PLATFORMS[id].url).protocol, 'https:')
})
