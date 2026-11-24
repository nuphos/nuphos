import type { AgentCredentialOptions } from '@/routes/agent/types'

/** One of a few kinds, an online and an offline computer, and Resend. */
export const options: AgentCredentialOptions = {
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
  personalCredentials: [
    { id: 'c-gh', provider: 'github', login: 'octocat' },
    { id: 'c-gm', provider: 'gmail', login: 'me@example.com' },
    { id: 'c-gc', provider: 'google-calendar', login: 'me@example.com' },
  ],
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
  plaudAccounts: [],
  cloudflareAccounts: [],
  instaboxAccounts: [],
}
