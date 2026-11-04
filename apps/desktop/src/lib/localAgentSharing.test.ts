import assert from 'node:assert/strict'
import test from 'node:test'

import { localAgentMoveWarning, OWN_LOCAL_AGENT_MOVE_NOTICE } from './localAgentSharing.ts'

const local = {
  ownerUserId: 'mate',
  deviceId: 'mac',
  deviceLabel: 'Mac',
  signedIn: true,
  shared: { level: 'full' as const },
}

test('moving to a borrowed computer explains visibility and who can still reply', () => {
  const warning = localAgentMoveWarning({ kind: 'local', local }, 'use', 'viewer')

  assert.equal(
    warning,
    'Its owner can see this work. People you shared it with can reply only if they can use this computer.',
  )
})

test('own Local Agents retain collaboration-loss consent without a host-trust notice', () => {
  for (const access of ['owner', 'manage'] as const) {
    const warning = localAgentMoveWarning({ kind: 'local', local }, access, 'viewer')

    assert.equal(warning, OWN_LOCAL_AGENT_MOVE_NOTICE)
    assert.match(warning ?? '', /reply only if they can use this computer/)
    assert.match(warning ?? '', /can still read/)
    assert.doesNotMatch(warning ?? '', /owner can see/)
  }
})

test('older own catalogs retain consent; own or managed Boxes need no host-trust prompt', () => {
  assert.equal(
    localAgentMoveWarning({ kind: 'local', local }, undefined, 'mate'),
    OWN_LOCAL_AGENT_MOVE_NOTICE,
  )
  assert.equal(localAgentMoveWarning({ kind: 'local' }), OWN_LOCAL_AGENT_MOVE_NOTICE)
  for (const access of ['owner', 'manage'] as const) {
    assert.equal(
      localAgentMoveWarning(
        { kind: 'local', local: { ...local, box: { state: 'running' } } },
        access,
        'viewer',
      ),
      undefined,
    )
  }
})

test('older shared catalogs and borrowed Boxes retain the short move notice', () => {
  assert.ok(localAgentMoveWarning({ kind: 'local', local }, undefined, 'viewer'))
  assert.ok(
    localAgentMoveWarning(
      { kind: 'local', local: { ...local, shared: undefined, box: { state: 'running' } } },
      'use',
      'viewer',
    ),
  )
})

test('moves onto hosted agents need no Local Agent consent', () => {
  assert.equal(localAgentMoveWarning({ kind: 'managed' }), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'external' }), undefined)
})
