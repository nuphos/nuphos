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

test('a move onto a teammate’s shared computer says whose it is and whether they approve', () => {
  const local = { ownerUserId: 'mate', deviceId: 'mac', deviceLabel: 'Mac', signedIn: true }
  const approve = localAgentMoveWarning({
    kind: 'local',
    local: { ...local, shared: { level: 'approve' } },
  })
  const full = localAgentMoveWarning({
    kind: 'local',
    local: { ...local, shared: { level: 'full' } },
  })

  assert.match(approve ?? '', /teammate’s own computer/)
  assert.match(approve ?? '', /They approve this agent/)
  assert.doesNotMatch(full ?? '', /They approve/)
})

test('moves onto hosted agents need no Local Agent consent', () => {
  assert.equal(localAgentMoveWarning({ kind: 'managed' }), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'external' }), undefined)
})
