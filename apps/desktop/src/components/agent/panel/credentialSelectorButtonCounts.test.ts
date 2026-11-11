import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMPTY_CREDENTIAL_ACCESS, EMPTY_CREDENTIAL_OPTIONS } from './constants.ts'
import {
  countSelectedCredentials,
  countTotalCredentials,
} from './credentialSelectorButtonCounts.ts'

test('device-only access leaves the credential badge empty', () => {
  assert.equal(countSelectedCredentials({ ...EMPTY_CREDENTIAL_ACCESS, deviceIds: ['mac'] }), 0)
  assert.equal(
    countTotalCredentials({
      ...EMPTY_CREDENTIAL_OPTIONS,
      devices: [{ deviceId: 'mac', label: 'Mac', platform: 'darwin' }],
    }),
    0,
  )
})

test('mixed access counts cloud credentials independently of devices', () => {
  assert.equal(
    countSelectedCredentials({
      ...EMPTY_CREDENTIAL_ACCESS,
      awsRoleIds: ['role'],
      githubInstallationIds: ['installation'],
      deviceIds: ['mac', 'pc'],
    }),
    2,
  )
})

test('Trello is counted as an explicitly selected credential independently of mail', () => {
  assert.equal(
    countSelectedCredentials({ ...EMPTY_CREDENTIAL_ACCESS, trelloIntegrationIds: ['trello'] }),
    1,
  )
  assert.equal(
    countTotalCredentials({
      ...EMPTY_CREDENTIAL_OPTIONS,
      trelloIntegrations: [{ integrationId: 'trello', label: 'Planning', username: 'example' }],
    }),
    1,
  )
  assert.deepEqual(EMPTY_CREDENTIAL_ACCESS.trelloIntegrationIds, [])
  assert.deepEqual(EMPTY_CREDENTIAL_ACCESS.resendIntegrationIds, [])
})
