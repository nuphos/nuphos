// Same init-order guard as the sibling preview tests.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useIdentity } from '@/lib/test/doubles/identity'
import { emptyConnectorCredentialOptions } from '@/routes/agent/credential-options-connectors'

import type { AgentConversation } from '@/lib/agent/db'
import type { AgentCredentialOptions } from '@/routes/agent/types'

const AZURE = '6a6b1e2f8002d55585a0989b'
const options = {
  awsRoles: [{ roleId: 'aws-1', accountId: '111111111111', accountAlias: null, roleArn: 'arn' }],
  gcpServiceAccounts: [],
  linodeAccounts: [],
  hetznerAccounts: [],
  tencentAccounts: [],
  aliyunAccounts: [],
  volcengineAccounts: [],
  huaweiAccounts: [],
  azureAccounts: [{ accountId: AZURE, label: 'Prod', subscriptionId: 'sub-1' }],
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
  devices: [{ deviceId: 'mac', label: 'Mac', platform: 'darwin', available: false }],
  ...emptyConnectorCredentialOptions(),
} as AgentCredentialOptions

// The stored conversation. The tool reads a snapshot; the picker can edit the
// stored document before the tool writes.
let stored: { credentialAccess: Record<string, unknown> }
let pickerEditsAfterRead: (() => void) | undefined
const conversation = () =>
  ({
    sessionId: 's1',
    userId: 'u1',
    teamId: 't1',
    credentialAccess: structuredClone(stored.credentialAccess),
  }) as unknown as AgentConversation

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) as never })
useCredentialOptions({ getAgentCredentialOptions: async () => options })
useAgentDb({
  getConversationBySessionId: async () => {
    const read = conversation()

    pickerEditsAfterRead?.()

    return read
  },
  setConversationCredentialFields: async (_s, _u, _t, fields) => {
    Object.assign(stored.credentialAccess, fields)

    return conversation()
  },
  // The whole-selection write main used: replaces the stored selection with the given one.
  updateConversationCredentialAccess: async (_s, _u, _t, access) => {
    stored.credentialAccess = { ...access }

    return conversation()
  },
})

const { nuphosUpdateCredentials } = await import('./credentials')

beforeEach(() => {
  stored = {
    credentialAccess: { awsRoleIds: ['aws-1'], azureAccountIds: [AZURE], deviceIds: ['mac'] },
  }
  pickerEditsAfterRead = undefined
})

const run = async () =>
  JSON.stringify(
    await nuphosUpdateCredentials({ team_id: 't1', session_id: 's1' }, { userId: 'u1' } as never),
  )

describe('nuphos_update_credentials', () => {
  test('replaces the categories it can name and keeps devices and the rest', async () => {
    expect(await run()).not.toContain('isError":true')
    expect(stored.credentialAccess).toMatchObject({
      // Named by the tool and omitted: revoked, as documented.
      awsRoleIds: [],
      // Not something the tool can set: left as they were.
      azureAccountIds: [AZURE],
      deviceIds: ['mac'],
    })
  })

  test('a picker edit made between its read and its write survives', async () => {
    pickerEditsAfterRead = () => {
      stored.credentialAccess.deviceIds = ['mac', 'other-mac']
    }

    expect(await run()).not.toContain('isError":true')
    expect(stored.credentialAccess.deviceIds).toEqual(['mac', 'other-mac'])
    expect(stored.credentialAccess.awsRoleIds).toEqual([])
  })
})
