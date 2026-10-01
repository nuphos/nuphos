import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  includeBoundOnpremCredential,
  newConversationCredentialAccessForRequest,
} from './credentialRequest.ts'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'

const emptyAccess: AgentCredentialSelection = {
  awsRoleIds: [],
  gcpServiceAccountIds: [],
  linodeAccountIds: [],
  hetznerAccountIds: [],
  tencentAccountIds: [],
  aliyunAccountIds: [],
  volcengineAccountIds: [],
  huaweiAccountIds: [],
  azureAccountIds: [],
  onpremClusterIds: [],
  betterStackIntegrationIds: [],
  uptimeKumaInstanceIds: [],
  linearWorkspaceIds: [],
  jiraSiteIds: [],
  asanaAccountIds: [],
  sentryAccountIds: [],
  posthogIntegrationIds: [],
  tailscaleClientIds: [],
  zeaburIds: [],
  vantaIntegrationIds: [],
  secureframeIntegrationIds: [],
  resendIntegrationIds: [],
  githubInstallationIds: [],
  gitlabBindingIds: [],
  grafanaInstanceIds: [],
  sonarqubeIntegrationIds: [],
  notionIntegrationIds: [],
  upstashAccountIds: [],
  cloudflareAccountIds: [],
}

const cluster = {
  clusterId: '66b11a4bd267393baaa11111',
  label: 'acme-dc1',
  contextName: 'onprem/acme-dc1/cluster',
}

const options: AgentCredentialOptions = {
  awsRoles: [],
  gcpServiceAccounts: [],
  linodeAccounts: [],
  hetznerAccounts: [],
  tencentAccounts: [],
  aliyunAccounts: [],
  volcengineAccounts: [],
  huaweiAccounts: [],
  azureAccounts: [],
  onpremClusters: [cluster],
  betterStackIntegrations: [],
  uptimeKumaInstances: [],
  linearWorkspaces: [],
  jiraSites: [],
  asanaAccounts: [],
  sentryAccounts: [],
  posthogIntegrations: [],
  tailscaleClients: [],
  zeaburProviders: [],
  vantaIntegrations: [],
  secureframeIntegrations: [],
  resendIntegrations: [],
  githubInstallations: [],
  gitlabBindings: [],
  grafanaInstances: [],
  sonarqubeIntegrations: [],
  notionIntegrations: [],
  upstashAccounts: [],
  cloudflareAccounts: [],
}

describe('newConversationCredentialAccessForRequest', () => {
  test('keeps an unresolved empty selection explicit instead of granting every option', () => {
    assert.equal(newConversationCredentialAccessForRequest(emptyAccess), emptyAccess)
  })
})

describe('includeBoundOnpremCredential', () => {
  test('selects the on-prem cluster bound to the Kubernetes workspace', () => {
    assert.deepEqual(
      includeBoundOnpremCredential(emptyAccess, options, cluster.contextName).onpremClusterIds,
      [cluster.clusterId],
    )
  })

  test('does not grant a context absent from permission-filtered options', () => {
    assert.equal(
      includeBoundOnpremCredential(emptyAccess, options, 'onprem/other/cluster'),
      emptyAccess,
    )
  })
})
