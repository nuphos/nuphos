import assert from 'node:assert/strict'
import { test } from 'node:test'

import { offlineMember } from './botPresenceRuntime.ts'

test('a group chat names a member Bot whose computer is offline, and no other', () => {
  const agents = [
    { sessionId: 'a', title: 'Atlas', ownerId: 'o', presence: { state: 'busy' } },
    {
      sessionId: 's',
      title: 'Scribe',
      ownerId: 'o',
      presence: { state: 'offline', reason: 'computer_offline' },
    },
  ] as never

  assert.equal(offlineMember(agents), 'Scribe')
  assert.equal(offlineMember([agents[0]] as never), undefined)
})
