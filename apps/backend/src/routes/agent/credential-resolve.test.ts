import { describe, expect, test } from 'bun:test'

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
    devices: [{ deviceId: 'device-1', label: 'MacBook', platform: 'darwin' }],
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

  test('never grants an id outside the caller options', () => {
    expect(
      availableCredentialAccess({ awsRoleIds: ['other-team-role'] }, credentialOptions())
        .awsRoleIds,
    ).toEqual([])
  })

  test('a device that went offline (or was never available) silently drops out of the selection', () => {
    const access = availableCredentialAccess(
      { deviceIds: ['device-1', 'now-offline-device'] },
      credentialOptions(),
    )

    expect(access.deviceIds).toEqual(['device-1'])
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
