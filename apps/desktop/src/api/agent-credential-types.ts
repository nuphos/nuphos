// Mirrors `AgentCredentialSelection` / `AgentCredentialOptions` in the
// backend's routes/agent/types.ts.
export type AgentCredentialSelection = {
  awsRoleIds: string[]
  gcpServiceAccountIds: string[]
  linodeAccountIds: string[]
  hetznerAccountIds: string[]
  tencentAccountIds: string[]
  aliyunAccountIds: string[]
  volcengineAccountIds: string[]
  huaweiAccountIds: string[]
  azureAccountIds: string[]
  onpremClusterIds: string[]
  betterStackIntegrationIds: string[]
  uptimeKumaInstanceIds: string[]
  linearWorkspaceIds: string[]
  jiraSiteIds: string[]
  asanaAccountIds: string[]
  sentryAccountIds: string[]
  posthogIntegrationIds: string[]
  tailscaleClientIds: string[]
  zeaburIds: string[]
  vantaIntegrationIds: string[]
  secureframeIntegrationIds: string[]
  resendIntegrationIds: string[]
  githubInstallationIds: string[]
  gitlabBindingIds: string[]
  grafanaInstanceIds: string[]
  sonarqubeIntegrationIds: string[]
  notionIntegrationIds: string[]
  upstashAccountIds: string[]
  cloudflareAccountIds: string[]
  deviceIds: string[]
}

export type AgentCredentialAccess = AgentCredentialSelection & {
  updatedAt?: string
  updatedBy?: string
}

export type AgentCredentialOptions = {
  awsRoles: {
    roleId: string
    accountId: string
    accountAlias: string | null
    roleArn: string
  }[]
  gcpServiceAccounts: {
    serviceAccountId: string
    projectId: string
    serviceAccountEmail: string
  }[]
  linodeAccounts: {
    accountId: string
    label: string
  }[]
  hetznerAccounts: {
    accountId: string
    label: string
  }[]
  tencentAccounts: {
    accountId: string
    label: string
    roleArn: string
  }[]
  aliyunAccounts: {
    accountId: string
    label: string
    roleArn: string
  }[]
  volcengineAccounts: {
    accountId: string
    label: string
    roleTrn: string
  }[]
  huaweiAccounts: {
    accountId: string
    label: string
    domainId: string
    idpId: string
  }[]
  azureAccounts: {
    accountId: string
    label: string
    subscriptionId: string
  }[]
  onpremClusters: {
    clusterId: string
    label: string
    contextName: string
  }[]
  betterStackIntegrations: {
    integrationId: string
    label: string
    hasUptimeApiToken: boolean
    hasTelemetryApiToken: boolean
  }[]
  uptimeKumaInstances: {
    instanceId: string
    label: string
    baseUrl: string
    authType: 'password' | 'token'
  }[]
  linearWorkspaces: {
    workspaceId: string
    label: string
    workspaceName: string
  }[]
  jiraSites: {
    siteId: string
    label: string
    siteUrl: string
  }[]
  asanaAccounts: {
    accountId: string
    label: string
    accountEmail: string | null
  }[]
  sentryAccounts: {
    accountId: string
    label: string
    userEmail: string | null
  }[]
  posthogIntegrations: {
    integrationId: string
    label: string
    apiBaseUrl: string
    projects: { id: number; name: string }[]
  }[]
  tailscaleClients: {
    clientId: string
    label: string
    oauthClientId: string
  }[]
  zeaburProviders: {
    zeaburId: string
    kind: 'user' | 'team'
    name: string
  }[]
  vantaIntegrations: {
    integrationId: string
    label: string
    authType: 'client_credentials' | 'oauth'
  }[]
  secureframeIntegrations: {
    integrationId: string
    label: string
    region: 'us' | 'uk'
  }[]
  resendIntegrations: {
    integrationId: string
    label: string
    permission: 'full_access' | 'sending_access'
  }[]
  githubInstallations: {
    installationId: string
    accountLogin: string
    accountType: 'User' | 'Organization'
  }[]
  gitlabBindings: {
    bindingId: string
    hostUrl: string
    username: string
  }[]
  grafanaInstances: {
    instanceId: string
    name: string
    grafanaUrl: string
  }[]
  sonarqubeIntegrations: {
    integrationId: string
    label: string
    baseUrl: string
  }[]
  notionIntegrations: {
    integrationId: string
    label: string
    workspaceName: string | null
  }[]
  upstashAccounts: {
    accountId: string
    label: string
    email: string | null
  }[]
  cloudflareAccounts: {
    accountId: string
    accountName: string | null
  }[]
  devices: {
    deviceId: string
    label: string
    platform: string
  }[]
}

export type AgentConversationCredentialsResponse = {
  credentialAccess: AgentCredentialAccess
  options: AgentCredentialOptions
}
