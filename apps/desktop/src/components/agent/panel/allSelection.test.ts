import assert from 'node:assert/strict'
import { test } from 'node:test'

import { expandAll, setAll, withoutAll } from './allSelection.ts'
import { EMPTY_CREDENTIAL_OPTIONS } from './constants.ts'
import { emptyCredentialAccess, normalizeCredentialAccess } from './credentialAccess.ts'

import type { AgentCredentialOptions } from '../../../api'

const options: AgentCredentialOptions = {
  ...EMPTY_CREDENTIAL_OPTIONS,
  awsRoles: [{ roleId: 'aws-1', accountId: '1', accountAlias: null, roleArn: 'arn' }],
  devices: [
    { deviceId: 'mac', label: 'Mac', platform: 'darwin', available: true },
    { deviceId: 'off', label: 'Off', platform: 'linux', available: false },
  ],
}

test('All draws every credential, including one added after it was saved', () => {
  const shown = expandAll({ ...emptyCredentialAccess(), allCredentials: true }, options)

  assert.deepEqual(shown.awsRoleIds, ['aws-1'])
  assert.deepEqual(shown.deviceIds, [])
})

test('All computers draws the usable ones', () => {
  const shown = expandAll({ ...emptyCredentialAccess(), allDevices: true }, options)

  assert.deepEqual(shown.deviceIds, ['mac'])
  assert.deepEqual(shown.awsRoleIds, [])
})

test('turning All off keeps what it covered, ticked', () => {
  const on = setAll(emptyCredentialAccess(), options, 'allCredentials', true)
  const off = setAll(on, options, 'allCredentials', false)

  assert.equal(on.allCredentials, true)
  assert.equal(off.allCredentials, undefined)
  assert.deepEqual(off.awsRoleIds, ['aws-1'])
})

test('a hand-picked change leaves All, and the flag survives normalize', () => {
  const value = { ...emptyCredentialAccess(), allCredentials: true, allDevices: true }

  assert.equal(withoutAll(value, 'allDevices').allDevices, undefined)
  assert.equal(withoutAll(value, 'allDevices').allCredentials, true)
  assert.equal(normalizeCredentialAccess(value).allDevices, true)
})
