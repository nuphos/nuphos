import { describe, expect, test } from 'bun:test'

import { options } from '@/lib/test/credential-options-fixture'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'

useCredentialOptions({ getAgentCredentialOptions: () => Promise.resolve(options) })

const { defaultCredentialAccess, resolveTriggerCredentialAccess } =
  await import('./credential-access')

describe('resolveTriggerCredentialAccess', () => {
  test('defaults a Trigger to every credential the principal can use', async () => {
    const access = await resolveTriggerCredentialAccess('team-1', 'principal')

    expect(access.awsRoleIds).toEqual(['role-1'])
    expect(access.resendIntegrationIds).toEqual(['mail'])
    expect(access.githubInstallationIds).toEqual(['github'])
    // Offline or long-gone registrations are not defaulted in.
    expect(access.deviceIds).toEqual(['mac'])
    expect(access.updatedBy).toBe('principal')
  })

  test('the member’s own Personal Credentials follow the connector rule', async () => {
    const { allCredentialAccessFromOptions } = await import('./credential-access')
    const trigger = await resolveTriggerCredentialAccess('team-1', 'principal')
    const unset = allCredentialAccessFromOptions(options, 'principal')

    expect(trigger.personalCredentialIds).toEqual(['github', 'gmail', 'google-calendar'])
    // Unset, like githubInstallationIds: absent reaches every one.
    expect(unset.personalCredentialIds).toBeUndefined()
    expect(unset.githubInstallationIds).toBeUndefined()
  })
})

test("a new Bot's default is All: everything its owner may use, and ones added later", async () => {
  const access = await defaultCredentialAccess('team-1', 'owner')

  expect(access.awsRoleIds).toEqual(['role-1'])
  expect(access.githubInstallationIds).toEqual(['github'])
  expect(access.personalCredentialIds).toEqual(['github', 'gmail', 'google-calendar'])
  expect(access.deviceIds).toEqual(['mac'])
  expect(access.resendIntegrationIds).toEqual(['mail'])
  expect(access).toMatchObject({ allCredentials: true, allDevices: true })
})
