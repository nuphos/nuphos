import { describe, expect, test } from 'bun:test'

import { ensurePreviewChannelCredentials } from './chat-preview-credentials'

import type { AgentCredentialOptions } from './types'
import type { AgentConversation, AgentCredentialAccess } from '@/lib/agent/db'

function credentialOptions(): AgentCredentialOptions {
  return {
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
    resendIntegrations: [],
    devices: [],
    githubInstallations: [],
    gitlabBindings: [],
    grafanaInstances: [],
    sonarqubeIntegrations: [],
    notionIntegrations: [],
    upstashAccounts: [],
    posthogIntegrations: [],
    cloudflareAccounts: [],
  }
}

const baseArgs = {
  channelOriginated: true,
  sessionId: 'conversation-1',
  teamId: 'team-1',
  actorUserId: 'user-1',
  conversationOwnerUserId: 'user-1',
  acceptedTurn: Promise.resolve(),
}

describe('ensurePreviewChannelCredentials', () => {
  test('persists available credentials before the first channel prompt', async () => {
    let updated: AgentCredentialAccess | undefined
    const conversation = { sessionId: 'conversation-1' } as AgentConversation

    await ensurePreviewChannelCredentials(baseArgs, {
      getConversation: () => Promise.resolve(conversation),
      getCredentialOptions: () => Promise.resolve(credentialOptions()),
      updateCredentialAccess: (_sessionId, _userId, _teamId, access) => {
        updated = access

        return Promise.resolve({ ...conversation, credentialAccess: access })
      },
    })

    expect(updated?.awsRoleIds).toEqual(['role-1'])
    expect(updated?.updatedBy).toBe('user-1')
  })

  test('explicit channel defaults select every available connector, including Resend', async () => {
    let updated: AgentCredentialAccess | undefined
    const options = credentialOptions()

    options.resendIntegrations = [
      { integrationId: 'mail', label: 'Mail', permission: 'full_access' },
    ]
    options.githubInstallations = [
      { installationId: 'github', accountLogin: 'team', accountType: 'Organization' },
    ]
    const conversation = { sessionId: 'conversation-1' } as AgentConversation

    await ensurePreviewChannelCredentials(
      { ...baseArgs, selectAllCredentials: true },
      {
        getConversation: async () => conversation,
        getCredentialOptions: async () => options,
        updateCredentialAccess: async (_sessionId, _userId, _teamId, access) => {
          updated = access

          return { ...conversation, credentialAccess: access }
        },
      },
    )
    expect(updated?.awsRoleIds).toEqual(['role-1'])
    expect(updated?.resendIntegrationIds).toEqual(['mail'])
    expect(updated?.githubInstallationIds).toEqual(['github'])
  })

  test('preserves an existing explicit selection', async () => {
    let writes = 0
    const conversation = {
      sessionId: 'conversation-1',
      credentialAccess: { githubInstallationIds: ['chosen-installation'] },
    } as AgentConversation

    await ensurePreviewChannelCredentials(baseArgs, {
      getConversation: () => Promise.resolve(conversation),
      getCredentialOptions: () => Promise.resolve(credentialOptions()),
      updateCredentialAccess: () => {
        writes++

        return Promise.resolve(conversation)
      },
    })

    expect(writes).toBe(0)
  })

  test('does not write one channel actor defaults onto another owner conversation', async () => {
    let reads = 0

    await ensurePreviewChannelCredentials(
      { ...baseArgs, actorUserId: 'actor-2' },
      {
        getConversation: () => {
          reads++

          return Promise.resolve(null)
        },
        getCredentialOptions: () => Promise.resolve(credentialOptions()),
        updateCredentialAccess: () => Promise.resolve(null),
      },
    )

    expect(reads).toBe(0)
  })
})
