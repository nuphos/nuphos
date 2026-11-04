import assert from 'node:assert/strict'
import test from 'node:test'

import { needsComputerUse } from './computerUse.ts'

// What a first invite (grantComputerUse: false) of someone who cannot use the
// computer looks like once it crosses IPC: the backend's code inside the message.
const firstAttempt = new Error(
  `Error invoking remote method 'agent:inviteConversationParticipants': Error: __ATLAS_API_ERROR__${JSON.stringify(
    {
      message: 'Adding this person to the conversation also gives them use of Mac. Continue?',
      code: 'computer_use_required',
      details: { userIds: ['u4'], computer: { deviceId: 'd1', label: 'Mac' } },
    },
  )}`,
)

test('the first invite of someone without the computer asks to confirm', () => {
  assert.equal(needsComputerUse(firstAttempt), true)
})

test('other invite failures are not a confirmation', () => {
  const managerOnly = new Error(
    `__ATLAS_API_ERROR__${JSON.stringify({ message: 'Ask its owner', code: 'computer_manage_required' })}`,
  )

  assert.equal(needsComputerUse(managerOnly), false)
  assert.equal(needsComputerUse(new Error('fetch failed')), false)
})
