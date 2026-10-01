import { ObjectId } from 'mongodb'

import { describe, expect, test } from 'bun:test'

import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentCredentialAccess } from './db'
import type { AgentTrigger } from './trigger-db'
import type { AgentCredentialOptions } from '@/routes/agent/types'

const EMPTY_OPTIONS: AgentCredentialOptions = {
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
  githubInstallations: [],
  gitlabBindings: [],
  grafanaInstances: [],
  sonarqubeIntegrations: [],
  notionIntegrations: [],
  upstashAccounts: [],
  posthogIntegrations: [],
  cloudflareAccounts: [],
}

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
    updatedBy: 'principal',
    ...overrides,
  }
}

const writes: { name: string; filter: unknown; update: unknown }[] = []
let teamOptions: AgentCredentialOptions = EMPTY_OPTIONS
let group: Record<string, unknown> | null = null

useDb({
  db: () =>
    ({
      collection: (name: string) => ({
        updateOne: (filter: unknown, update: unknown) => {
          writes.push({ name, filter, update })

          return Promise.resolve({})
        },
        findOne: () => Promise.resolve(name === 'agent_trigger_groups' ? group : null),
        find: () => ({ toArray: () => Promise.resolve([]) }),
      }),
    }) as never,
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'ADMINISTRATOR' }) as never })
useCredentialOptions({ getAgentCredentialOptions: () => Promise.resolve(teamOptions) })

const { resolveExecutionAuthorization } = await import('./trigger-executor-authorization')

function trigger(overrides: Partial<AgentTrigger> = {}): AgentTrigger {
  return {
    userId: 'principal',
    teamId: 'team-1',
    executionPrincipalUserId: 'principal',
    executionAuthorizationStatus: 'valid',
    name: 'nightly',
    triggerType: 'cron',
    messageTemplate: 'check',
    enabled: true,
    ...overrides,
  } as AgentTrigger
}

describe('resolveExecutionAuthorization', () => {
  test('a Trigger bound to every credential sees a connector added after it was created', async () => {
    writes.length = 0
    teamOptions = {
      ...EMPTY_OPTIONS,
      notionIntegrations: [{ integrationId: 'notion-late', workspaceName: 'Team' }],
    } as AgentCredentialOptions

    const { credentialAccess } = await resolveExecutionAuthorization(
      trigger({
        credentialMode: 'all',
        executionCredentialAccess: access({ notionIntegrationIds: [] }),
      }),
    )

    expect(credentialAccess.notionIntegrationIds).toEqual(['notion-late'])
    expect(writes).toEqual([])
  })

  test('a Trigger the user narrowed keeps exactly its selection', async () => {
    teamOptions = {
      ...EMPTY_OPTIONS,
      notionIntegrations: [{ integrationId: 'notion-late', workspaceName: 'Team' }],
    } as AgentCredentialOptions

    const { credentialAccess } = await resolveExecutionAuthorization(
      trigger({
        credentialMode: 'selected',
        executionCredentialAccess: access({ notionIntegrationIds: [] }),
      }),
    )

    expect(credentialAccess.notionIntegrationIds).toEqual([])
  })

  test('a Trigger stored before the mode existed follows the team, and nothing is pinned to it', async () => {
    writes.length = 0
    teamOptions = {
      ...EMPTY_OPTIONS,
      notionIntegrations: [{ integrationId: 'notion-late', workspaceName: 'Team' }],
    } as AgentCredentialOptions

    const { credentialAccess } = await resolveExecutionAuthorization(
      trigger({
        executionCredentialAccess: access({ notionIntegrationIds: [] }),
      }),
    )

    expect(credentialAccess.notionIntegrationIds).toEqual(['notion-late'])
    expect(writes).toEqual([])
  })
})

describe('resolveExecutionAuthorization on a Trigger created from an Agent session', () => {
  test('keeps the scope that session approved', async () => {
    teamOptions = {
      ...EMPTY_OPTIONS,
      notionIntegrations: [{ integrationId: 'notion-late', workspaceName: 'Team' }],
    } as AgentCredentialOptions

    const { credentialAccess } = await resolveExecutionAuthorization(
      trigger({
        sourceContext: { sessionId: 'conv-1' },
        executionCredentialAccess: access({ notionIntegrationIds: [] }),
      }),
    )

    expect(credentialAccess.notionIntegrationIds).toEqual([])
  })
})

describe('a partition repairing itself from its Watch Group', () => {
  test('drops the scope it had pinned when the Group has none', async () => {
    writes.length = 0
    teamOptions = EMPTY_OPTIONS
    group = { executionPrincipalUserId: 'new-principal', credentialMode: 'all' }

    await resolveExecutionAuthorization(
      trigger({
        watchGroupId: new ObjectId(),
        executionCredentialAccess: access({ notionIntegrationIds: [] }),
      }),
    )

    const repair = writes.find((write) => write.name === 'agent_triggers')

    expect(repair?.update).toMatchObject({
      $set: { executionPrincipalUserId: 'new-principal', credentialMode: 'all' },
      $unset: { executionCredentialAccess: true },
    })
  })
})
