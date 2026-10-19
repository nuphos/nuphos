import assert from 'node:assert/strict'
import test from 'node:test'

import { runtimeControlSendBlock, selectedAgentReachability } from './runtimeControlSignOut.ts'

import type { RuntimeControl } from './RuntimeSelector'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

const id = 'local:u:box1:claude-code'
const noop = (_id: string) => {
  /* picking is not under test */
}

function control(
  local: Partial<NonNullable<RuntimeInstance['local']>> | undefined,
  quota?: Partial<RuntimeQuota>,
): RuntimeControl {
  return {
    value: { id, provider: 'claude-code', label: 'Claude Code' },
    options: [
      {
        id,
        provider: 'claude-code',
        label: 'Claude Code',
        status: 'active',
        kind: local ? 'local' : 'managed',
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
  for (const signedOut of [
    control({ online: true, signedIn: false }),
    control({ online: true }, { available: false, reason: 'Sign in required' }),
    control(undefined, { available: false, reason: 'Sign in required' }),
  ]) {
    assert.equal(selectedAgentReachability(signedOut), 'signIn')
    assert.equal(runtimeControlSendBlock(signedOut), 'The agent needs to sign in')
  }
})

test('red: an agent whose Box is offline cannot send, whatever its sign-in', () => {
  const offline = control({ online: false, signedIn: false })

  assert.equal(selectedAgentReachability(offline), 'offline')
  assert.equal(runtimeControlSendBlock(offline), 'Its Box is offline')
})

test('an agent without a Box has no dot and is not blocked', () => {
  assert.equal(selectedAgentReachability(control(undefined)), null)
  assert.equal(runtimeControlSendBlock(control(undefined)), null)
})
