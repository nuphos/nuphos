import { describe, expect, test } from 'bun:test'

import { emptyConnectorCredentialOptions } from './credential-options-connectors'
import { resolveConnectorCredentialAccess } from './credential-resolve-connectors'

import type { AgentCredentialOptions } from './types'

function options(): AgentCredentialOptions {
  return {
    awsRoles: [],
    gcpServiceAccounts: [],
    linodeAccounts: [],
    hetznerAccounts: [],
    tencentAccounts: [],
    aliyunAccounts: [],
    volcengineAccounts: [],
    huaweiAccounts: [],
    azureAccounts: [],
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
    githubInstallations: [
      { installationId: '123456', accountLogin: 'acme', accountType: 'Organization' },
    ],
    grafanaInstances: [
      { instanceId: '66b11a4bd267393baaa11111', name: 'Prod', grafanaUrl: 'https://g.example' },
    ],
  }
}

describe('resolveConnectorCredentialAccess', () => {
  test('keeps an absent selection absent so the conversation stays team-wide', () => {
    expect(resolveConnectorCredentialAccess({}, options())).toEqual({
      githubInstallationIds: undefined,
      gitlabBindingIds: undefined,
      grafanaInstanceIds: undefined,
      sonarqubeIntegrationIds: undefined,
      notionIntegrationIds: undefined,
      upstashAccountIds: undefined,
      cloudflareAccountIds: undefined,
    })
  })

  test('stores a present selection, empty included', () => {
    const resolved = resolveConnectorCredentialAccess(
      { githubInstallationIds: ['123456'], grafanaInstanceIds: [] },
      options(),
    )

    expect(resolved.githubInstallationIds).toEqual(['123456'])
    expect(resolved.grafanaInstanceIds).toEqual([])
  })

  test('drops a binding the caller can no longer reach instead of refusing the turn', () => {
    const resolved = resolveConnectorCredentialAccess(
      { githubInstallationIds: ['123456', '999999'], grafanaInstanceIds: ['deleted'] },
      options(),
    )

    expect(resolved.githubInstallationIds).toEqual(['123456'])
    expect(resolved.grafanaInstanceIds).toEqual([])
  })
})
