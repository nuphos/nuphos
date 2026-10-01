import { describe, expect, test } from 'bun:test'

import { emptyConnectorCredentialOptions } from '@/routes/agent/credential-options-connectors'

import { credentialAccessForExecution } from './shared'

import type { AgentCredentialOptions } from '@/routes/agent/types'

function optionsForActor(): AgentCredentialOptions {
  return {
    awsRoles: [],
    gcpServiceAccounts: [],
    linodeAccounts: [],
    hetznerAccounts: [],
    tencentAccounts: [],
    aliyunAccounts: [],
    volcengineAccounts: [],
    huaweiAccounts: [],
    azureAccounts: [
      {
        accountId: 'actor-azure',
        label: 'Actor subscription',
        subscriptionId: 'actor-subscription',
      },
    ],
    onpremClusters: [],
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
    devices: [],
    ...emptyConnectorCredentialOptions(),
  }
}

describe('shared conversation execution principal policy', () => {
  test('the owner keeps the durable conversation selection', () => {
    const access = credentialAccessForExecution(
      { userId: 'owner-1', sessionId: 'conv-1' },
      { azureAccountIds: ['owner-azure'] },
    )

    expect(access.azureAccountIds).toEqual(['owner-azure'])
  })

  test('another actor never inherits the owner selection', () => {
    const access = credentialAccessForExecution(
      {
        userId: 'actor-2',
        conversationOwnerUserId: 'owner-1',
        sessionId: 'conv-1',
      },
      { azureAccountIds: ['owner-azure'] },
      optionsForActor(),
    )

    expect(access.azureAccountIds).toEqual(['actor-azure'])
    expect(access.azureAccountIds).not.toContain('owner-azure')
    expect(access.resendIntegrationIds).toEqual([])
    // Not narrowed for a non-owner actor either: an absent array still means
    // the connector's team-wide reach.
    expect(access.githubInstallationIds).toBeUndefined()
  })

  test('all-credential channel turns still select only the current actor bindings', () => {
    const options = optionsForActor()

    options.resendIntegrations = [
      { integrationId: 'actor-mail', label: 'Mail', permission: 'full_access' },
    ]
    options.githubInstallations = [
      { installationId: 'actor-github', accountLogin: 'actor', accountType: 'Organization' },
    ]
    const access = credentialAccessForExecution(
      { userId: 'actor-2', conversationOwnerUserId: 'owner-1', sessionId: 'conv-1' },
      { resendIntegrationIds: ['owner-mail'], githubInstallationIds: ['owner-github'] },
      options,
      true,
    )

    expect(access.resendIntegrationIds).toEqual(['actor-mail'])
    expect(access.githubInstallationIds).toEqual(['actor-github'])
  })

  test('actor credential discovery failure fails closed', () => {
    const access = credentialAccessForExecution(
      {
        userId: 'actor-2',
        conversationOwnerUserId: 'owner-1',
        sessionId: 'conv-1',
      },
      { azureAccountIds: ['owner-azure'] },
    )

    expect(access.azureAccountIds).toEqual([])
  })

  test('an owner selection for the newly scoped connectors survives normalization', () => {
    const access = credentialAccessForExecution(
      { userId: 'owner-1', sessionId: 'conv-1' },
      { grafanaInstanceIds: ['grafana-1'], cloudflareAccountIds: [] },
    )

    expect(access.grafanaInstanceIds).toEqual(['grafana-1'])
    expect(access.cloudflareAccountIds).toEqual([])
    expect(access.githubInstallationIds).toBeUndefined()
  })
})
