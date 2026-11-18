import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { EMPTY_CREDENTIAL_OPTIONS } from './constants.ts'
import { storedConversationCredentialAccess } from './conversationCredentialAccess.ts'
import { normalizeCredentialOptions } from './credentialAccess.ts'

const options = normalizeCredentialOptions({
  awsRoles: [{ roleId: 'prod' }],
  githubInstallations: [{ installationId: 'gh' }],
  devices: [{ deviceId: 'mac-mini', label: 'Mac mini', platform: 'darwin', available: true }],
} as never)

// The backend runs a conversation with nothing stored with none of what the user
// opts into, and with team-wide reach where absence means that: the picker shows that.
describe("a conversation's stored selection, as its picker shows it", () => {
  test('nothing stored selects no computers and no opt-in credentials', () => {
    const shown = storedConversationCredentialAccess(null, options)

    assert.deepEqual(shown.deviceIds, [])
    assert.deepEqual(shown.awsRoleIds, [])
    assert.deepEqual(shown.githubInstallationIds, ['gh'])
  })

  test('nothing stored shows nothing selected before the options load', () => {
    assert.deepEqual(
      storedConversationCredentialAccess(undefined, EMPTY_CREDENTIAL_OPTIONS).deviceIds,
      [],
    )
  })

  test('a stored selection shows as stored', () => {
    const shown = storedConversationCredentialAccess({ deviceIds: ['mac-mini'] }, options)

    assert.deepEqual(shown.deviceIds, ['mac-mini'])
    assert.deepEqual(shown.awsRoleIds, [])
  })
})
