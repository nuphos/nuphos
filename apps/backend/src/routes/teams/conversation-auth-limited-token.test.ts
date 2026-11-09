import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useAgentsIdentity } from '@/lib/test/doubles/agents-identity'
import { useTokenRevocation } from '@/lib/test/doubles/token-revocation'

import { dispatchConversationTeamApi, requireUserOrConversationAuth } from './conversation-auth'

// Revocation has its own suite; these tokens are never revoked.
useTokenRevocation({ isTokenRevoked: async () => false, inheritRevocation: async () => false })

useAgentsIdentity({
  verifyAgentForActor: async (userId, owner, sessionId) => ({
    userId,
    sessionId,
    conversationOwnerUserId: owner,
  }),
})
// The selection as the request sees it once a limit to aws/role-1 is applied.
const install = useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ awsRoleIds: ['role-1'], githubInstallationIds: [] }),
})

const app = new Hono()

app.onError(errorHandler)
app.use('/teams/:teamId/*', requireUserOrConversationAuth, dispatchConversationTeamApi)
app.all('*', (c) => c.text('reached'))

const token = (limited: boolean) =>
  mintPreviewMcpToken({
    userId: '64b000000000000000000001',
    sessionId: 'conv-1',
    teamId: 'team-1',
    ...(limited
      ? { credentialLimit: { awsRoleIds: ['role-1'] }, resources: ['credential:aws/role-1'] }
      : {}),
  })

async function get(path: string, limited = true) {
  const res = await app.request(path, {
    headers: { Authorization: `Bearer ${await token(limited)}` },
  })

  return `${String(res.status)} ${await res.text()}`
}

describe('a limited token on the /teams mount', () => {
  test('is refused on canonical routes that are not one of its connector bindings', async () => {
    // A trigger read carries its webhook secret; it is not a credential this token names.
    expect(await get('/teams/team-1/agent-triggers/t1')).toContain(
      'This token is limited to credentials',
    )
    expect(await get('/teams/team-1/members')).toContain('This token is limited to credentials')
    // A connector binding outside the limit fails the selection check.
    expect(await get('/teams/team-1/github-installations/gh-1')).toMatch(/^403 /u)
  })

  test('an unlimited token still reaches the canonical routes', async () => {
    expect(await get('/teams/team-1/agent-triggers/t1', false)).toBe('200 reached')
  })
})

// One read-only instance list per provider; the remaining four share the shape.
const cloudReads = [
  '/teams/team-1/tencent-accounts/tencent-1/clusters',
  '/teams/team-1/aliyun-accounts/aliyun-1/ecs-instances',
  '/teams/team-1/volcengine-accounts/volcengine-1/ecs-instances',
]

describe('cloud instance reads on the /teams mount', () => {
  test('refuses an account the conversation did not select', async () => {
    install({
      getAgentCredentialAccess: async () => ({
        tencentAccountIds: [],
        aliyunAccountIds: [],
        volcengineAccountIds: [],
      }),
    })

    for (const path of cloudReads) {
      expect(await get(path), path).toContain('conversation_api_forbidden')
    }
  })

  test('reaches the account the conversation selected', async () => {
    install({
      getAgentCredentialAccess: async () => ({
        tencentAccountIds: ['tencent-1'],
        aliyunAccountIds: ['aliyun-1'],
        volcengineAccountIds: ['volcengine-1'],
      }),
    })

    for (const path of cloudReads) {
      expect(await get(path, false), path).toBe('200 reached')
    }
  })
})
