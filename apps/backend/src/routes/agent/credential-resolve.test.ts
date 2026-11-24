import { describe, expect, test } from 'bun:test'

import { expandAllCredentialAccess } from './credential-access'
import { emptyConnectorCredentialOptions } from './credential-options-connectors'
import { availableCredentialAccess, withOmittedKeysFromStored } from './credential-resolve'
import { normalizeCredentialSelection } from './team-scope'
import { includeBoundOnpremCluster } from './credential-resolve-onprem'

import type { AgentCredentialOptions } from './types'
import type { AgentCredentialAccess } from '@/lib/agent/db'

const cluster = {
  clusterId: '66b11a4bd267393baaa11111',
  label: 'acme-dc1',
  contextName: 'onprem/acme-dc1/cluster',
}
const options = [cluster]

describe('includeBoundOnpremCluster', () => {
  test('adds the permission-filtered cluster bound to the workspace tab', () => {
    expect(includeBoundOnpremCluster([], options, 'onprem/acme-dc1/cluster')).toEqual([
      cluster.clusterId,
    ])
  })

  test('cannot add a context absent from the allowed options', () => {
    expect(includeBoundOnpremCluster([], options, 'onprem/other/cluster')).toEqual([])
  })

  test('does not duplicate an explicitly selected cluster', () => {
    expect(
      includeBoundOnpremCluster([cluster.clusterId], options, 'onprem/acme-dc1/cluster'),
    ).toEqual([cluster.clusterId])
  })
})

function credentialOptions(): AgentCredentialOptions {
  return {
    awsRoles: [
      { roleId: 'aws-1', accountId: '111111111111', accountAlias: null, roleArn: 'arn:aws:iam::1' },
    ],
    gcpServiceAccounts: [],
    linodeAccounts: [],
    hetznerAccounts: [],
    tencentAccounts: [],
    aliyunAccounts: [],
    volcengineAccounts: [],
    huaweiAccounts: [],
    azureAccounts: [{ accountId: 'az-1', label: 'Prod', subscriptionId: 'sub-1' }],
    onpremClusters: [cluster],
    betterStackIntegrations: [],
    uptimeKumaInstances: [],
    linearWorkspaces: [],
    jiraSites: [],
    asanaAccounts: [],
    sentryAccounts: [],
    tailscaleClients: [],
    zeaburProviders: [],
    vantaIntegrations: [],
    secureframeIntegrations: [],
    resendIntegrations: [],
    personalCredentials: [],
    devices: [
      { deviceId: 'device-1', label: 'MacBook', platform: 'darwin', available: true },
      { deviceId: 'device-asleep', label: 'Asleep', platform: 'darwin', available: false },
    ],
    ...emptyConnectorCredentialOptions(),
  }
}

describe('availableCredentialAccess', () => {
  test('a deleted connector in the selection is dropped and the rest is kept', () => {
    const access = availableCredentialAccess(
      {
        awsRoleIds: ['aws-1', 'aws-deleted'],
        azureAccountIds: ['az-deleted'],
        onpremClusterIds: ['deleted-cluster'],
      },
      credentialOptions(),
    )

    expect(access.awsRoleIds).toEqual(['aws-1'])
    expect(access.azureAccountIds).toEqual([])
    expect(access.onpremClusterIds).toEqual([])
  })

  test('keeps the conversation’s team identity choice, known providers only', () => {
    expect(
      availableCredentialAccess(
        normalizeCredentialSelection({ teamIdentity: ['github', 'gitlab'] }),
        credentialOptions(),
      ).teamIdentity,
    ).toEqual(['github'])
    expect(
      availableCredentialAccess(normalizeCredentialSelection({}), credentialOptions()),
    ).not.toHaveProperty('teamIdentity')
  })

  test('never grants an id outside the caller options', () => {
    expect(
      availableCredentialAccess({ awsRoleIds: ['other-team-role'] }, credentialOptions())
        .awsRoleIds,
    ).toEqual([])
  })

  test('a ticked device that is asleep stays ticked beside an online one of the same name', () => {
    const sameName = {
      ...credentialOptions(),
      devices: [
        { deviceId: 'office-mac', label: 'MacBook-Pro.local', platform: 'darwin', available: true },
        { deviceId: 'home-mac', label: 'MacBook-Pro.local', platform: 'darwin', available: false },
      ],
    }

    expect(availableCredentialAccess({ deviceIds: ['home-mac'] }, sameName).deviceIds).toEqual([
      'home-mac',
    ])
  })

  test('stores exactly the ticked devices of the caller, online or not', () => {
    const offered = credentialOptions()

    expect(
      availableCredentialAccess({ deviceIds: ['device-1', 'device-asleep'] }, offered).deviceIds,
    ).toEqual(['device-1', 'device-asleep'])
    // Unticking an offline device removes it.
    expect(availableCredentialAccess({ deviceIds: ['device-1'] }, offered).deviceIds).toEqual([
      'device-1',
    ])
    // A device that is not the caller's, or no longer exists, cannot be selected.
    expect(
      availableCredentialAccess({ deviceIds: ['someone-elses-device'] }, offered).deviceIds,
    ).toEqual([])
  })
})

describe('withOmittedKeysFromStored', () => {
  const stored: AgentCredentialAccess = {
    awsRoleIds: [],
    gcpServiceAccountIds: [],
    linodeAccountIds: [],
    hetznerAccountIds: [],
    betterStackIntegrationIds: [],
    uptimeKumaInstanceIds: [],
    tailscaleClientIds: [],
    zeaburIds: [],
    vantaIntegrationIds: [],
    secureframeIntegrationIds: [],
    jiraSiteIds: [],
    asanaAccountIds: [],
    deviceIds: ['device-1'],
    updatedAt: new Date(),
    updatedBy: 'u1',
  }
  const resolve = (selection: unknown) =>
    availableCredentialAccess(
      normalizeCredentialSelection(withOmittedKeysFromStored(selection, stored)),
      credentialOptions(),
    )

  test('a client that omits deviceIds keeps the stored device selection', () => {
    const access = resolve({ awsRoleIds: [] })

    expect(access.deviceIds).toEqual(['device-1'])
    expect(access.awsRoleIds).toEqual([])
  })

  test('an explicit empty list still clears the stored selection', () => {
    expect(resolve({ deviceIds: [] }).deviceIds).toEqual([])
  })

  test('without a stored selection an omitted key stays empty', () => {
    expect(withOmittedKeysFromStored({ awsRoleIds: [] }, undefined)).toEqual({ awsRoleIds: [] })
  })

  test('a missing selection is left for normalization, not filled from storage', () => {
    expect(withOmittedKeysFromStored(undefined, stored)).toBeUndefined()
  })
})

describe('All', () => {
  const resolve = (selection: unknown, offered = credentialOptions()) =>
    availableCredentialAccess(normalizeCredentialSelection(selection), offered)

  test('All credentials takes every credential offered now and keeps the choice', () => {
    const access = resolve({ allCredentials: true, deviceIds: [] })

    expect(access.allCredentials).toBe(true)
    expect(access.awsRoleIds).toEqual(['aws-1'])
    expect(access.azureAccountIds).toEqual(['az-1'])
    expect(access.deviceIds).toEqual([])
  })

  test('All computers takes the usable computers and keeps the choice', () => {
    const access = resolve({ allDevices: true })

    expect(access.allDevices).toBe(true)
    expect(access.deviceIds).toEqual(['device-1'])
    expect(access.awsRoleIds).toEqual([])
  })

  test('a stored All covers a credential or computer added later', () => {
    const stored = resolve({ allCredentials: true, allDevices: true })
    const later = credentialOptions()

    later.awsRoles.push({
      roleId: 'aws-2',
      accountId: '222222222222',
      accountAlias: null,
      roleArn: 'arn:aws:iam::2',
    })
    later.devices.push({
      deviceId: 'box-1',
      label: 'Box',
      platform: 'linux',
      available: false,
      box: { ready: true },
    })

    const expanded = expandAllCredentialAccess(stored, later)

    expect(expanded.awsRoleIds).toEqual(['aws-1', 'aws-2'])
    expect(expanded.deviceIds).toEqual(['device-1', 'box-1'])
  })

  test('a stored All drops a credential or computer revoked since', () => {
    const stored = resolve({ allCredentials: true, allDevices: true })
    const later = credentialOptions()

    later.awsRoles = []
    later.devices = later.devices.map((device) => ({ ...device, available: false }))

    const expanded = expandAllCredentialAccess(stored, later)

    expect(stored.awsRoleIds).toEqual(['aws-1'])
    expect(expanded.awsRoleIds).toEqual([])
    expect(expanded.deviceIds).toEqual([])
  })

  test('without All, a selection is left as stored', () => {
    const stored = availableCredentialAccess({ awsRoleIds: ['aws-1'] }, credentialOptions())

    expect(stored).not.toHaveProperty('allCredentials')
    expect(expandAllCredentialAccess(stored, credentialOptions())).toBe(stored)
  })
})
