import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'

import type { AgentCredentialAccess } from '../db'
import type { AgentCredentialOptions } from '@/routes/agent/types'

const options = {
  awsRoles: [{ roleId: 'prod' }],
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
  githubInstallations: [{ installationId: 'github' }],
  gitlabBindings: [],
  grafanaInstances: [],
  sonarqubeIntegrations: [],
  notionIntegrations: [],
  upstashAccounts: [],
  posthogIntegrations: [],
  plaudAccounts: [],
  cloudflareAccounts: [],
  devices: [],
} as unknown as AgentCredentialOptions

function access(overrides: Partial<AgentCredentialAccess> = {}): AgentCredentialAccess {
  return {
    awsRoleIds: [],
    gcpServiceAccountIds: [],
    linodeAccountIds: [],
    hetznerAccountIds: [],
    betterStackIntegrationIds: [],
    uptimeKumaInstanceIds: [],
    jiraSiteIds: [],
    asanaAccountIds: [],
    tailscaleClientIds: [],
    zeaburIds: [],
    vantaIntegrationIds: [],
    secureframeIntegrationIds: [],
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: 'creator',
    ...overrides,
  }
}

let sessionScope: AgentCredentialAccess | undefined

useCredentialOptions({ getAgentCredentialOptions: () => Promise.resolve(options) })
let sessionTeamId: string | undefined = 'team-1'

useAgentDb({
  getConversationBySessionId: (sessionId: string) =>
    Promise.resolve(
      sessionId === 's1' ? { teamId: sessionTeamId, credentialAccess: sessionScope } : null,
    ) as never,
})

const { resolveTriggerCredentialSelection } = await import('./quota')

const context = { userId: 'creator', teamId: 'team-1' } as const

describe('resolveTriggerCredentialSelection', () => {
  test('a Desktop caller binds to every credential, with nothing pinned', async () => {
    expect(await resolveTriggerCredentialSelection({ ...context })).toEqual({
      credentialMode: 'all',
    })
  })

  test('a caller that names a scope is taken at its word', async () => {
    const chosen = access({ awsRoleIds: ['prod'] })

    expect(
      await resolveTriggerCredentialSelection({ ...context, credentialAccess: chosen }),
    ).toEqual({ credentialMode: 'selected', executionCredentialAccess: chosen })
  })

  test('a session narrowed by the user bounds the Trigger it creates', async () => {
    sessionScope = access({ awsRoleIds: ['prod'], githubInstallationIds: [] })

    expect(await resolveTriggerCredentialSelection({ ...context, sessionId: 's1' })).toEqual({
      credentialMode: 'selected',
      executionCredentialAccess: sessionScope,
    })
  })

  test('a session holding everything the creator can reach expresses no narrowing', async () => {
    sessionScope = access({ awsRoleIds: ['prod'], githubInstallationIds: ['github'] })

    expect(await resolveTriggerCredentialSelection({ ...context, sessionId: 's1' })).toEqual({
      credentialMode: 'all',
    })
  })

  test('a session the caller does not share is refused instead of widening to all', async () => {
    sessionScope = access({ awsRoleIds: ['prod'] })

    await expect(
      resolveTriggerCredentialSelection({ ...context, sessionId: 'missing' }),
    ).rejects.toMatchObject({ status: 403 })

    sessionTeamId = 'team-2'
    await expect(
      resolveTriggerCredentialSelection({ ...context, sessionId: 's1' }),
    ).rejects.toMatchObject({ status: 403 })
    sessionTeamId = 'team-1'
  })
})
