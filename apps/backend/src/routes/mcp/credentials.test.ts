// Same init-order guard as the sibling preview tests.
import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useIdentity } from '@/lib/test/doubles/identity'
import { emptyConnectorCredentialOptions } from '@/routes/agent/credential-options-connectors'

import type { AgentConversation, AgentCredentialAccess } from '@/lib/agent/db'
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

const writes: AgentCredentialAccess[] = []
const conversation = {
  sessionId: 's1',
  userId: 'u1',
  teamId: 't1',
  credentialAccess: { awsRoleIds: ['aws-1'], azureAccountIds: [AZURE], deviceIds: ['mac'] },
} as unknown as AgentConversation

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) as never })
useCredentialOptions({ getAgentCredentialOptions: async () => options })
useAgentDb({
  getConversationBySessionId: async () => conversation,
  updateConversationCredentialAccess: async (_s, _u, _t, access) => {
    writes.push(access)

    return conversation
  },
})

const { nuphosUpdateCredentials } = await import('./credentials')

describe('nuphos_update_credentials', () => {
  test('replaces the categories it can name and keeps devices and the rest', async () => {
    const result = await nuphosUpdateCredentials({ team_id: 't1', session_id: 's1' }, {
      userId: 'u1',
    } as never)

    expect(JSON.stringify(result)).not.toContain('isError":true')

    expect(writes.at(-1)).toMatchObject({
      // Named by the tool and omitted: revoked, as documented.
      awsRoleIds: [],
      // Not something the tool can set: left as they were.
      azureAccountIds: [AZURE],
      deviceIds: ['mac'],
    })
  })
})
