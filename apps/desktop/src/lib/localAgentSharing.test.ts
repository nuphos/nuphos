import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCAL_AGENT_SHARING_NOTE, localAgentMoveWarning } from './localAgentSharing.ts'

const local = {
  ownerUserId: 'mate',
  deviceId: 'mac',
  deviceLabel: 'Mac',
  signedIn: true,
  shared: { level: 'full' as const },
}

test('moving to a borrowed computer explains visibility and owner-only messages in one sentence', () => {
  const warning = localAgentMoveWarning({ kind: 'local', local }, 'use', 'viewer')

  assert.equal(
    warning,
    'Its owner can see this work, and only you can send messages in this agent.',
  )
})

test('owner and manage access never add a move disclosure, even with a legacy shared marker', () => {
  for (const access of ['owner', 'manage'] as const) {
    assert.equal(localAgentMoveWarning({ kind: 'local', local }, access, 'viewer'), undefined)
  }
})

test('an older catalog does not warn on the viewer’s own computer', () => {
  assert.equal(localAgentMoveWarning({ kind: 'local', local }, undefined, 'mate'), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'local' }), undefined)
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

test('sharing a conversation retains its separate owner-only messaging explanation', () => {
  assert.match(LOCAL_AGENT_SHARING_NOTE, /only you can send messages/)
})
