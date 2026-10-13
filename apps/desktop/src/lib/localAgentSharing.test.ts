import assert from 'node:assert/strict'
import test from 'node:test'

import { localAgentMoveWarning } from './localAgentSharing.ts'

test('every move onto a Local Agent asks for consent, even with only the owner in the session', () => {
  // The decision takes no participants: any current team member can reply to a
  // team session, so an owner-only participant list grants no less access.
  const warning = localAgentMoveWarning({ kind: 'local' })

  assert.ok(warning)
  assert.match(warning, /anyone in this team/)
})

test('moves onto hosted agents need no Local Agent consent', () => {
  assert.equal(localAgentMoveWarning({ kind: 'managed' }), undefined)
  assert.equal(localAgentMoveWarning({ kind: 'external' }), undefined)
})
