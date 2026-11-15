// Same init-order guard as the sibling route tests.
import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { emptyConnectorCredentialOptions } from '@/routes/agent/credential-options-connectors'
import { nuphosUpdateCredentials } from '@/routes/mcp/credentials'

import { agent } from './router'

import type { AgentConversation } from '@/lib/agent/db'
import type { AgentCredentialOptions } from '@/routes/agent/types'

// Both ways of selecting a credential respond only once the question it answers
// is closed, so a client that reloads the open questions then sees it gone.
// The agent's turn never settles here: neither waits for it.

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const options = {
  awsRoles: [
    {
      roleId: 'cccccccccccccccccccccccc',
      accountId: '111111111111',
      accountAlias: null,
      roleArn: 'arn',
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
  personalCredentials: [],
  devices: [],
  ...emptyConnectorCredentialOptions(),
} as AgentCredentialOptions

let open: boolean
let woken: number
let woke: PromiseWithResolvers<void>
const conversation = () =>
  ({
    sessionId: 's1',
    userId: caller,
    teamId,
    credentialAccess: { awsRoleIds: [] },
    inputRequests: open
      ? [
          {
            id: 'q-aws',
            category: 'integration',
            question: 'Connect AWS',
            providers: ['aws'],
            askedAt: new Date(),
            status: 'open',
          },
        ]
      : [],
  }) as unknown as AgentConversation

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }) as never,
  getTeamMembership: async () => ({ role: 'MEMBER' }) as never,
})
useCredentialOptions({ getAgentCredentialOptions: async () => options })
useAgentDb({
  getConversationBySessionId: async () => conversation(),
  getReadableConversation: async () => conversation(),
  credentialHeirs: async () => ['s1'],
  setConversationCredentialFields: async () => conversation(),
  updateConversationCredentialAccess: async () => conversation(),
})
useDb({
  db: () =>
    ({
      collection: () => ({
        updateOne: async (filter: Record<string, unknown>) => {
          // A real write takes longer than the response's own microtasks.
          await new Promise((resolve) => setTimeout(resolve, 5))
          // Only the write that closes the question: background writes other
          // suites left running in this process reach this double too.
          if (!('inputRequests.id' in filter)) return { matchedCount: 0 }
          const closes = open

          open = false

          return { matchedCount: closes ? 1 : 0 }
        },
      }),
    }) as never,
})
useConversationTurn({
  startConversationTurn: async () => {
    woken += 1
    woke.resolve()

    return { status: 'started' as const, run: new Promise<undefined>(() => {}) }
  },
})

const app = new Hono().route('/agent', agent)

app.onError((error, c) => c.json({ error: error.message }, 500))

beforeEach(() => {
  open = true
  woken = 0
  woke = Promise.withResolvers()
})

test('the picker responds with the question it answered already closed', async () => {
  const response = await app.request(`/agent/conversations/s1/credentials?teamId=${teamId}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId,
      credentialAccess: { awsRoleIds: ['cccccccccccccccccccccccc'] },
    }),
  })

  expect(await response.text()).toContain('credentialAccess')
  expect(response.status).toBe(200)
  expect(open).toBe(false)
})

test('update_credentials responds with the question it answered already closed', async () => {
  const result = await nuphosUpdateCredentials(
    { team_id: teamId, session_id: 's1', aws_role_ids: ['cccccccccccccccccccccccc'] },
    { userId: caller } as never,
  )

  expect(JSON.stringify(result)).not.toContain('isError":true')
  expect(open).toBe(false)
  await woke.promise
  expect(woken).toBe(1)
})
