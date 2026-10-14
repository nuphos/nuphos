import { describe, expect, test } from 'bun:test'

import { useCredentialOptions } from '@/lib/test/doubles/credential-options'

import type { AgentCredentialOptions } from './types'

const options: AgentCredentialOptions = {
  awsRoles: [
    {
      roleId: 'role-1',
      accountId: '123456789012',
      accountAlias: 'production',
      roleArn: 'arn:aws:iam::123456789012:role/Nuphos',
    },
  ],
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
  resendIntegrations: [{ integrationId: 'mail', label: 'Mail', permission: 'full_access' }],
  devices: [
    { deviceId: 'mac', label: 'Mac', platform: 'darwin', available: true },
    { deviceId: 'old-mac', label: 'Mac', platform: 'darwin', available: false },
  ],
  githubInstallations: [
    { installationId: 'github', accountLogin: 'team', accountType: 'Organization' },
  ],
  gitlabBindings: [],
  grafanaInstances: [],
  sonarqubeIntegrations: [],
  notionIntegrations: [],
  upstashAccounts: [],
  posthogIntegrations: [],
  cloudflareAccounts: [],
}

useCredentialOptions({ getAgentCredentialOptions: () => Promise.resolve(options) })

const { resolveTriggerCredentialAccess } = await import('./credential-access')

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
})
