import assert from 'node:assert/strict'
import test from 'node:test'

import {
  runtimeControlSendBlock,
  selectedAgentName,
  selectedAgentReachability,
} from './runtimeControlSignOut.ts'

import type { RuntimeControl } from './RuntimeSelector'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

const id = 'local:u:box1:claude-code'
const noop = (_id: string) => {
  /* picking is not under test */
}

function control(
  local: Partial<NonNullable<RuntimeInstance['local']>> | undefined,
  quota?: Partial<RuntimeQuota>,
  kind: RuntimeInstance['kind'] = local ? 'local' : 'managed',
): RuntimeControl {
  return {
    value: { id, provider: 'claude-code', label: 'Claude Code' },
    options: [
      {
        id,
        provider: 'claude-code',
        label: 'Claude Code',
        status: 'active',
        kind,
        createdAt: '',
        ...(local ? { local: { deviceLabel: 'Box 1', signedIn: true, ...local } } : {}),
      } as RuntimeInstance,
    ],
    quotas: quota ? new Map([[id, quota as RuntimeQuota]]) : undefined,
    onSelect: noop,
  }
}

test('green: an online Box with a signed-in agent sends', () => {
  assert.equal(selectedAgentReachability(control({ online: true })), 'ready')
  assert.equal(runtimeControlSendBlock(control({ online: true })), null)
})

test('yellow: a signed-out agent on an online Box cannot send', () => {
  const signedOut = control({ online: true, signedIn: false })

  assert.equal(selectedAgentReachability(signedOut), 'signIn')
  assert.equal(runtimeControlSendBlock(signedOut), 'The runtime needs to sign in')
})

test('red: an agent whose Box is offline cannot send, whatever its sign-in', () => {
  const offline = control({ online: false, signedIn: false })

  assert.equal(selectedAgentReachability(offline), 'offline')
  assert.equal(runtimeControlSendBlock(offline), 'Its computer is offline')
})

test('the usage probe sign-in guess never makes an agent yellow or blocks it', () => {
  const probeOnly = { available: false, reason: 'Sign in required' }

  for (const agent of [
    control(undefined, probeOnly, 'external'),
    control(undefined, probeOnly, 'managed'),
    control({ online: true }, probeOnly),
  ]) {
    assert.notEqual(selectedAgentReachability(agent), 'signIn')
    assert.equal(runtimeControlSendBlock(agent), null)
  }
})

test('an agent without a Box has no dot and is not blocked', () => {
  assert.equal(selectedAgentReachability(control(undefined)), null)
  assert.equal(runtimeControlSendBlock(control(undefined)), null)
})

test('a signed-out agent is named with its computer, not as the computer', () => {
  assert.equal(selectedAgentName(control({ signedIn: false })), 'Claude Code on Box 1')
  assert.equal(
    selectedAgentName(control({ signedIn: false, agentLabel: 'Reviewer' })),
    'Reviewer on Box 1',
  )
  assert.equal(selectedAgentName(control(undefined)), 'Claude Code')
  assert.equal(selectedAgentName({ value: null }), 'The runtime')
})
