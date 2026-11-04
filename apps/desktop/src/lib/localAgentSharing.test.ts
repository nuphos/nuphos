import assert from 'node:assert/strict'
import test from 'node:test'

import { localAgentMoveWarning, moveNotice } from './localAgentSharing.ts'

const local = {
  ownerUserId: 'mate',
  deviceId: 'mac',
  deviceLabel: 'Mac',
  signedIn: true,
  shared: { level: 'full' as const },
}

test('moving onto a borrowed computer says its owner can see the work', () => {
  assert.equal(
    localAgentMoveWarning({ kind: 'local', local }, 'use', 'viewer'),
    'Its owner can see this work.',
  )
  // Older catalogs that report only the share.
  assert.ok(localAgentMoveWarning({ kind: 'local', local }, undefined, 'viewer'))
  assert.ok(
    localAgentMoveWarning(
      { kind: 'local', local: { ...local, shared: undefined, box: { state: 'running' } } },
      'use',
      'viewer',
    ),
  )
})

test('your own or managed computers, and hosted agents, need no host-trust notice', () => {
  for (const access of ['owner', 'manage'] as const)
    assert.equal(localAgentMoveWarning({ kind: 'local', local }, access, 'viewer'), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'local', local }, undefined, 'mate'), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'local' }), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'managed' }), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'external' }), undefined)
})

test('a move names who would lose reply, and offers the computer when the mover can give it', () => {
  const target = { label: 'Claude Code in Mac' }
  const losing = [
    { id: 'u2', name: 'Sam' },
    { id: 'u3', name: 'Jordan' },
  ]
  const computer = { deviceId: 'mac', label: 'Mac' }

  assert.equal(moveNotice(target, undefined, null), undefined)
  assert.equal(moveNotice(target, undefined, { computer, losing: [], canGrant: true }), undefined)
  assert.equal(
    moveNotice(target, undefined, { computer, losing, canGrant: true }),
    'Moving this conversation will give these teammates use of Mac: Sam, Jordan. Continue?',
  )
  assert.equal(
    moveNotice(target, 'Its owner can see this work.', { computer, losing, canGrant: false }),
    'Its owner can see this work. Sam, Jordan can’t use Mac, so after the move they can only view this conversation.',
  )
})
