import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCAL_AGENT_SHARING_NOTE, localAgentMoveWarning } from './localAgentSharing.ts'

test('a move onto a Local Agent says that only the owner can send messages afterwards', () => {
  // The backend refuses a teammate's turn on a Local Agent, so the move leaves
  // everyone else read-only rather than handing them the owner's computer.
  const warning = localAgentMoveWarning({ kind: 'local' })

  assert.ok(warning)
  assert.match(warning, /only you can send messages/)
  assert.doesNotMatch(warning, /run commands on your computer/)
})

test('the Share note no longer says teammates can run commands on the computer', () => {
  assert.match(LOCAL_AGENT_SHARING_NOTE, /only you can send messages/)
  assert.doesNotMatch(LOCAL_AGENT_SHARING_NOTE, /run commands on your computer/)
})

test('a move onto a teammate’s shared computer discloses host access and partial audit visibility', () => {
  const local = { ownerUserId: 'mate', deviceId: 'mac', deviceLabel: 'Mac', signedIn: true }
  const approve = localAgentMoveWarning({
    kind: 'local',
    local: { ...local, shared: { level: 'approve' } },
  })
  const full = localAgentMoveWarning({
    kind: 'local',
    local: { ...local, shared: { level: 'full' } },
  })

  for (const warning of [approve, full]) {
    assert.match(warning ?? '', /not a private sandbox/)
    assert.match(warning ?? '', /same operating-system account/)
    assert.match(warning ?? '', /conversation context, files and credentials/)
    assert.match(warning ?? '', /90 days/)
    assert.match(warning ?? '', /Only you can send messages/)
    assert.match(warning ?? '', /coverage is incomplete/)
    assert.doesNotMatch(warning ?? '', /They approve|runs as them/)
  }
})

test('moves onto hosted agents need no Local Agent consent', () => {
  assert.equal(localAgentMoveWarning({ kind: 'managed' }), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'external' }), undefined)
})

test('a Box also discloses shared-host access before a move', () => {
  const warning = localAgentMoveWarning({
    kind: 'local',
    local: {
      ownerUserId: 'owner',
      deviceId: 'vm',
      deviceLabel: 'VM',
      signedIn: true,
      box: { state: 'running' },
    },
  })

  assert.match(warning ?? '', /not a private sandbox/)
})
