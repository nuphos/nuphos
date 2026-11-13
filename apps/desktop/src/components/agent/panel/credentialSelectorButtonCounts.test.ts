import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMPTY_CREDENTIAL_ACCESS, EMPTY_CREDENTIAL_OPTIONS } from './constants.ts'
import { allCredentialAccess } from './credentialAccess.ts'
import {
  countSelectedCredentials,
  countTotalCredentials,
} from './credentialSelectorButtonCounts.ts'

import type { AgentCredentialOptions } from '../../../api'

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

// #1928: a team with one Huawei account read "38/37" after Select all. The total
// skipped Huawei while the selected count did not.
test('after Select all the selected count equals the total, for every kind', () => {
  const options = {
    ...EMPTY_CREDENTIAL_OPTIONS,
    awsRoles: [{ roleId: 'role' }],
    huaweiAccounts: [{ accountId: 'hw', label: 'Huawei', domainId: 'd', idpId: 'i' }],
    githubInstallations: [
      { installationId: 'i1', accountLogin: 'acme', accountType: 'Organization' },
    ],
    devices: [{ deviceId: 'mac', label: 'Mac', platform: 'darwin' }],
  } as unknown as AgentCredentialOptions
  const all = allCredentialAccess(options)

  assert.equal(countTotalCredentials(options), 3)
  assert.equal(countSelectedCredentials(all, options), 3)
})

test('a selected id the picker does not draw is not counted', () => {
  const options = { ...EMPTY_CREDENTIAL_OPTIONS, awsRoles: [{ roleId: 'role' }] } as never
  const value = { ...EMPTY_CREDENTIAL_ACCESS, awsRoleIds: ['role', 'deleted'] }

  assert.equal(countSelectedCredentials(value, options), 1)
  assert.equal(countSelectedCredentials(value), 2)
})
