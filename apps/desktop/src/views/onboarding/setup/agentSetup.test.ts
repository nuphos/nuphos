import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boxOpenCode, localAgentStatus, readyLocalAgents, setupAgentStatus } from './agentSetup.ts'

import type { AgentDevice, LocalRuntimeState } from '../../../api/device-types.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

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

test('disabled dev detection and runtime failures never stay checking', () => {
  const state = {
    detectionDisabled: true,
    agents: { codex: { cli: null } },
  } as unknown as LocalRuntimeState

  assert.equal(setupAgentStatus(state, 'codex'), 'unavailable')
  assert.equal(setupAgentStatus(null, 'codex'), 'checking')
  assert.equal(setupAgentStatus({ ...state, detectionDisabled: false }, 'codex'), 'checking')
  assert.equal(
    setupAgentStatus(
      {
        ...state,
        detectionDisabled: false,
        agents: {
          ...state.agents,
          codex: { available: false, online: false, cli: null, error: 'Missing bundle' },
        },
      },
      'codex',
    ),
    'unavailable',
  )
})

const on = (deviceId: string, provider = 'opencode') =>
  ({ id: `${provider}@${deviceId}`, provider, local: { deviceId } }) as RuntimeInstance

test('the Box’s OpenCode is the team’s runtime, not OpenCode on a person’s own computer', () => {
  const devices = [
    {
      deviceId: 'box',
      label: 'Computer 1',
      platform: 'linux',
      box: { provider: 'instabox', state: 'running' },
    },
    { deviceId: 'mac', label: 'Mac', platform: 'darwin' },
  ] as AgentDevice[]

  assert.equal(boxOpenCode([on('mac'), on('box', 'codex')], devices), undefined)
  assert.equal(boxOpenCode([on('mac'), on('box')], devices)?.id, 'opencode@box')
  // Before the device list arrives nothing is a Box.
  assert.equal(boxOpenCode([on('box')]), undefined)
})
